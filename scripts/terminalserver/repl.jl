# Most of the code here is copied from the Juno codebase

using REPL
using REPL.LineEdit

isREPL() = isdefined(Base, :active_repl) &&
           isdefined(Base.active_repl, :interface) &&
           isdefined(Base.active_repl.interface, :modes)

juliaprompt = "julia> "

current_prompt = juliaprompt

function get_main_mode()
  mode = Base.active_repl.interface.modes[1]
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
