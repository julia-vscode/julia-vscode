const NATIVE_HEADLESS_STATE = Ref{Any}(nothing)
const NATIVE_HEADLESS_OUTPUT_CHUNK_SIZE = 64 * 1024

function native_utf8_sequence_length(byte::UInt8)
    if byte <= 0x7f
        return 1
    elseif 0xc2 <= byte <= 0xdf
        return 2
    elseif 0xe0 <= byte <= 0xef
        return 3
    elseif 0xf0 <= byte <= 0xf4
        return 4
    end
    return 1
end

function native_incomplete_utf8_start(data::Vector{UInt8})
    last = length(data)
    last == 0 && return 1
    for first in last:-1:max(1, last - 3)
        byte = data[first]
        (byte & 0xc0) == 0x80 && continue
        sequence_length = native_utf8_sequence_length(byte)
        available = last - first + 1
        sequence_length <= available && return last + 1
        sequence_length == 1 && return last + 1
        all(index -> (data[index] & 0xc0) == 0x80, first + 1:last) || return last + 1
        return first
    end
    return last + 1
end

function send_native_headless_output(data::Vector{UInt8})
    first = 1
    while first <= length(data)
        last = min(first + NATIVE_HEADLESS_OUTPUT_CHUNK_SIZE - 1, length(data))
        while last > first && last < length(data) && (data[last + 1] & 0xc0) == 0x80
            last -= 1
        end
        try
            endpoint = conn_endpoint[]
            if endpoint !== nothing
                JSONRPC.send(
                    endpoint,
                    repl_headless_output_notification_type,
                    (; text=String(data[first:last]))
                )
                JSONRPC.flush(endpoint)
            end
        catch
        end
        first = last + 1
    end
    return nothing
end

function drain_native_headless_output(rd)
    carry = UInt8[]
    try
        while true
            data = try
                readavailable(rd)
            catch
                nothing
            end
            if data === nothing
                isempty(carry) || send_native_headless_output(carry)
                break
            end
            if isempty(data)
                done = try
                    eof(rd)
                catch
                    true
                end
                if done
                    isempty(carry) || send_native_headless_output(carry)
                    break
                end
                yield()
                continue
            end
            combined = isempty(carry) ? data : vcat(carry, data)
            incomplete_start = native_incomplete_utf8_start(combined)
            complete_end = incomplete_start - 1
            carry = copy(combined[incomplete_start:end])
            complete_end > 0 && send_native_headless_output(combined[1:complete_end])
        end
    finally
        try
            close(rd)
        catch
        end
    end
    return nothing
end

function enter_headless!()
    NATIVE_HEADLESS_STATE[] === nothing || return

    original_stdout = Base.stdout
    original_stderr = Base.stderr
    stdout_pipe = Base.redirect_stdout()
    stderr_pipe = try
        Base.redirect_stderr()
    catch
        Base.redirect_stdout(original_stdout)
        close(stdout_pipe.in)
        rethrow()
    end

    terminal = nothing
    terminal_stdout = nothing
    terminal_stderr = nothing
    if isdefined(Base, :active_repl)
        active_repl = try
            getfield(Base, :active_repl)
        catch
            nothing
        end
        candidate = active_repl === nothing ? nothing : try
            getproperty(active_repl, :t)
        catch
            nothing
        end
        if candidate isa REPL.Terminals.TTYTerminal &&
           Base.ismutabletype(typeof(candidate)) &&
           :out_stream in fieldnames(typeof(candidate)) &&
           :err_stream in fieldnames(typeof(candidate))
            terminal_stdout = candidate.out_stream
            terminal_stderr = candidate.err_stream
            try
                setproperty!(candidate, :out_stream, stdout_pipe.in)
                setproperty!(candidate, :err_stream, stderr_pipe.in)
                terminal = candidate
            catch
                try
                    setproperty!(candidate, :out_stream, terminal_stdout)
                    setproperty!(candidate, :err_stream, terminal_stderr)
                catch
                end
            end
        end
    end

    NATIVE_HEADLESS_STATE[] = (;
        original_stdout,
        original_stderr,
        stdout_pipe,
        stderr_pipe,
        terminal,
        terminal_stdout,
        terminal_stderr,
    )
    @async drain_native_headless_output(stdout_pipe.out)
    @async drain_native_headless_output(stderr_pipe.out)
    return nothing
end

function exit_headless!()
    state = NATIVE_HEADLESS_STATE[]
    state === nothing && return

    try
        Base.redirect_stdout(state.original_stdout)
        Base.redirect_stderr(state.original_stderr)
    finally
        if state.terminal !== nothing
            try
                setproperty!(state.terminal, :out_stream, state.terminal_stdout)
                setproperty!(state.terminal, :err_stream, state.terminal_stderr)
            catch
            end
        end
        try
            isopen(state.stdout_pipe.in) && close(state.stdout_pipe.in)
        catch
        end
        try
            isopen(state.stderr_pipe.in) && close(state.stderr_pipe.in)
        catch
        end
        NATIVE_HEADLESS_STATE[] = nothing
    end
    return nothing
end

function start_native_repl(conn_pipename, debug_pipename; is_dev=false, error_handler=nothing)
    control_pipe = pop!(ENV, "JULIA_VSCODE_RECONNECT_PIPE")
    session_id = pop!(ENV, "JULIA_VSCODE_SESSION_ID")
    token = pop!(ENV, "JULIA_VSCODE_SESSION_TOKEN")
    generation = Ref(1)
    server = Sockets.listen(control_pipe)
    chmod(control_pipe, 0o600)

    function connect_session(pipe, debug_pipe)
        serve(pipe, debug_pipe; is_dev, error_handler,
            native_session=(; sessionId=session_id, token, generation=generation[], juliaPid=getpid()))
    end

    @async while isopen(server)
        socket = try
            Sockets.accept(server)
        catch
            break
        end
        # Bound incomplete control messages without evaluating any terminal input.
        timer = Timer(5) do _
            isopen(socket) && close(socket)
        end
        try
            bytes = UInt8[]
            while length(bytes) < 8192
                byte = read(socket, UInt8)
                byte == 0x0a && break
                push!(bytes, byte)
            end
            request = JSON.parse(String(bytes))
            close(timer)
            if get(request, "sessionId", nothing) != session_id || get(request, "token", nothing) != token
                write(socket, "{\"ok\":false}\n")
                continue
            end
            operation = get(request, "operation", nothing)
            if operation == "interrupt"
                if get(request, "generation", nothing) != generation[]
                    write(socket, "{\"ok\":false}\n")
                    continue
                end
                repl_interrupt_notification(nothing, nothing)
                write(socket, "{\"ok\":true}\n")
                continue
            end
            if operation == "stop"
                write(socket, "{\"ok\":true}\n")
                flush(socket)
                close(socket)
                close(server)
                exit(0)
            end
            next_generation = get(request, "generation", nothing)
            if operation != "reconnect"
                write(socket, "{\"ok\":false}\n")
                continue
            end
            if !(next_generation isa Integer) || next_generation <= generation[]
                write(
                    socket,
                    JSON.json(Dict("ok" => false, "reason" => "stale", "generation" => generation[])) * "\n"
                )
                continue
            end
            pipe = get(request, "pipe", nothing)
            debug_pipe = get(request, "debugPipe", nothing)
            if !(pipe isa String) || !(debug_pipe isa String)
                write(socket, "{\"ok\":false}\n")
                continue
            end
            generation[] = next_generation
            old_endpoint = conn_endpoint[]
            if old_endpoint !== nothing
                close(old_endpoint)
                isopen(old_endpoint.pipe_in) && close(old_endpoint.pipe_in)
            end
            if get(request, "headless", false) === true
                enter_headless!()
            else
                exit_headless!()
            end
            connect_session(pipe, debug_pipe)
            write(socket, "{\"ok\":true}\n")
        catch err
            if !(err isa EOFError || err isa Base.IOError)
                @warn "Julia reconnect request failed; the Julia process is still running."
            end
        finally
            close(timer)
            isopen(socket) && close(socket)
        end
    end

    connect_session(conn_pipename, debug_pipename)
    return nothing
end
