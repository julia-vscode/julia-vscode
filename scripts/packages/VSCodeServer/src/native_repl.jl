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
            if operation != "reconnect" || !(next_generation isa Integer) || next_generation <= generation[]
                write(socket, "{\"ok\":false}\n")
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
