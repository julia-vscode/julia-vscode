# Most of the code here is copied from the Juno codebase

using REPL
using REPL.LineEdit

isREPL() = isdefined(Base, :active_repl) &&
           isdefined(Base.active_repl, :interface) &&
           isdefined(Base.active_repl.interface, :modes)

juliaprompt = "julia> "

current_prompt = juliaprompt

function get_main_mode(repl = Base.active_repl)
    mode = repl.interface.modes[1]
    mode isa LineEdit.Prompt || error("no julia repl mode found")
    mode
end

function hideprompt(f)
    isREPL() || return f()

    repl = Base.active_repl
    mistate = repl.mistate
    mode = mistate.current_mode

    buf = String(take!(copy(LineEdit.buffer(mistate))))

    # clear input buffer
    truncate(LineEdit.buffer(mistate), 0)
    LineEdit.refresh_multi_line(mistate)

    print(stdout, "\e[1K\r")
    r = f()

    flush(stdout)
    flush(stderr)
    sleep(0.05)

    # TODO Fix this
    # pos = @rpc cursorpos()
    pos = 1, 1
    pos[1] != 0 && println()

    # restore prompt
    if applicable(LineEdit.write_prompt, stdout, mode)
        LineEdit.write_prompt(stdout, mode)
    elseif mode isa LineEdit.PrefixHistoryPrompt || :parent_prompt in fieldnames(typeof(mode))
        LineEdit.write_prompt(stdout, mode.parent_prompt)
    else
        printstyled(stdout, current_prompt, color = :green)
    end

    truncate(LineEdit.buffer(mistate), 0)

    # restore input buffer
    LineEdit.edit_insert(LineEdit.buffer(mistate), buf)
    LineEdit.refresh_multi_line(mistate)
    r
end

function hook_repl(repl)
    if !isdefined(repl, :interface)
        repl.interface = REPL.setup_interface(repl)
    end
    main_mode = get_main_mode(repl)

    # TODO: set up REPL module ?
    main_mode.on_done = REPL.respond(repl, main_mode; pass_empty = false) do line
        quote
            $(evalrepl)(Main, $line, $repl, $main_mode)
        end
    end
end

function evalrepl(m, line, repl, main_mode)
    return try
        JSONRPC.send_notification(conn_endpoint[], "repl/starteval", nothing)
        try
            repleval(m, line, REPL.repl_filename(repl, main_mode.hist))
        catch err
            display_repl_error(stderr, err, stacktrace(catch_backtrace()))
            nothing
        end
    catch err
        # This is for internal errors only.
        Base.display_error(stderr, err, catch_backtrace())
        nothing
    finally
        JSONRPC.send_notification(conn_endpoint[], "repl/finisheval", nothing)
    end
end

# don't inline this so we can find it in the stacktrace
@noinline repleval(m, code, file) = include_string(m, code, file)

# basically the same as Base's `display_error`, with internal frames removed
function display_repl_error(io, err, st)
    ind = find_frame_index(st, @__FILE__, repleval)
    st = st[1:(ind === nothing ? end : ind - 2)]
    printstyled(io, "ERROR: "; bold = true, color = Base.error_color())
    showerror(IOContext(io, :limit => true), err, st)
    println(io)
end
display_repl_error(io, err::LoadError, st) = display_repl_error(io, err.error, st)

function withpath(f, path)
    tls = task_local_storage()
    hassource = haskey(tls, :SOURCE_PATH)
    hassource && (path′ = tls[:SOURCE_PATH])
    tls[:SOURCE_PATH] = path
    try
        return f()
    finally
        hassource ? (tls[:SOURCE_PATH] = path′) : delete!(tls, :SOURCE_PATH)
    end
end
