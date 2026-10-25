# Most of the code here is copied from the Juno codebase

using REPL
using REPL.LineEdit

const ENABLE_SHELL_INTEGRATION = Ref{Bool}(false)

# `getfield` rather than `.` on `Base.active_repl`, here and in `hideprompt`: the REPL is
# untyped, and Julia compiles `getproperty` for its type at the first call, while `getfield`
# needs no compiled method.
isREPL() = isdefined(Base, :active_repl) &&
           isdefined(Base.active_repl, :interface) &&
           isdefined(getfield(Base.active_repl, :interface), :modes) &&
           isdefined(Base.active_repl, :mistate) &&
           isdefined(getfield(Base.active_repl, :mistate), :current_mode)

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
    mistate = getfield(repl, :mistate)
    mode = getfield(mistate, :current_mode)

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
    elseif applicable(LineEdit.write_prompt, stdout, mode, true)
        LineEdit.write_prompt(stdout, mode, true)
    elseif mode isa LineEdit.PrefixHistoryPrompt || has_parent_prompt(mode)
        if applicable(LineEdit.write_prompt, stdout, mode.parent_prompt)
            LineEdit.write_prompt(stdout, mode.parent_prompt)
        elseif applicable(LineEdit.write_prompt, stdout, mode.parent_prompt, true)
            LineEdit.write_prompt(stdout, mode.parent_prompt, true)
        else
            printstyled(stdout, current_prompt, color = :green, bold = true)
        end
    else
        printstyled(stdout, current_prompt, color = :green, bold = true)
    end

    truncate(LineEdit.buffer(mistate), 0)

    # restore input buffer
    LineEdit.edit_insert(LineEdit.buffer(mistate), buf)
    LineEdit.refresh_multi_line(mistate)
    r
end

# A function of its own, so that it can be compiled in advance for the type of `mode`, where
# `fieldnames` is a constant.
has_parent_prompt(mode) = :parent_prompt in fieldnames(typeof(mode))

si(f) = (args...) -> ENABLE_SHELL_INTEGRATION[] ? f(args...) : ""

function sanitize_shell_integration_string(cmd)
    outbuffer = IOBuffer()
    for char in cmd
        ichar = UInt(char)
        if char === '\\'
            print(outbuffer, "\\\\")
        elseif ichar <= 0x20 || char === ';'
            ichar %= UInt8
            # `bytes2hex` takes a single byte only from Julia 1.7 on.
            print(outbuffer, "\\0x", string(ichar, base = 16, pad = 2))
        else
            print(outbuffer, char)
        end
    end
    return String(take!(outbuffer))
end

const SHELL = (
    prompt_start = si(() -> "\e]633;A\a"),
    prompt_end = si(() -> "\e]633;B\a"),
    output_start = si(() -> "\e]633;C\a"),
    output_end = si(function ()
        state = REPL_PROMPT_STATE[]
        REPL_PROMPT_STATE[] = REPLPromptStates.NoUpdate

        if state === REPLPromptStates.NoUpdate
            return ""
        elseif state === REPLPromptStates.NoStatus
            return "\e]633;D\a"
        else
            exitcode = state == REPLPromptStates.Error
            return "\e]633;D;$(Int(exitcode))\a"
        end
    end),
    update_cmd = si(function (cmd)
        nonce = SHELL_NONCE[]
        cmd = sanitize_shell_integration_string(cmd)
        if length(nonce) > 0
            "\e]633;E;$cmd;$nonce\a"
        else
            "\e]633;E;$cmd\a"
        end
    end),
    update_cwd = si(() -> "\e]633;P;Cwd=$(pwd())\a"),
    windows_compat = si(() -> "\e]633;P;IsWindows=True\a"),
    rich_integration = si(() -> "\e]633;P;HasRichCommandDetection=True\a")
)

as_func(x) = () -> x
as_func(x::Function) = x

const SHELL_NONCE = Ref("")
function install_vscode_shell_integration(prompt)
    if Sys.iswindows()
        print(stdout, SHELL.windows_compat())
    end
    print(stdout, SHELL.rich_integration())

    if haskey(ENV, "VSCODE_NONCE")
        SHELL_NONCE[] = ENV["VSCODE_NONCE"]
        delete!(ENV, "VSCODE_NONCE")
    end

    add_shell_integration!(prompt)
end

"""
    add_shell_integration!(prompt)

Wrap the prompt prefix, the prompt suffix and the `on_done` callback of the REPL prompt `prompt`
so that they write the shell integration sequences.
"""
function add_shell_integration!(prompt)
    prompt.prompt_prefix = BoundCall(shell_prompt_prefix, as_func(prompt.prompt_prefix))
    prompt.prompt_suffix = BoundCall(shell_prompt_suffix, as_func(prompt.prompt_suffix))
    prompt.on_done = BoundCall(shell_on_done, prompt.on_done)
    return prompt
end

"""
    shell_prompt_prefix(prefix)

Return `prefix()` with the shell integration sequences before it.
"""
shell_prompt_prefix(@nospecialize(prefix)) = string(SHELL.output_end(), SHELL.prompt_start(), prefix())

"""
    shell_prompt_suffix(suffix)

Return `suffix()` with the shell integration sequences after it.
"""
shell_prompt_suffix(@nospecialize(suffix)) = string(suffix(), SHELL.update_cwd(), SHELL.prompt_end())

"""
    shell_on_done(on_done, mi, buf, ok)

Report the command in `buf` to VS Code, then call the `on_done` callback of the REPL prompt.
"""
function shell_on_done(@nospecialize(on_done), @nospecialize(mi), buf, ok)
    # `copy` keeps `buf` intact as `deepcopy` does, but without the runtime dispatch in `deepcopy`,
    # which compiles `deepcopy_internal` on its first call in every session.
    print(stdout, SHELL.update_cmd(String(take!(copy(buf)))), SHELL.output_start())
    REPL_PROMPT_STATE[] = REPLPromptStates.NoStatus
    on_done(mi, buf, ok)
end

if VERSION > v"1.9-"
    active_module = Base.active_module
else
    active_module() = Main
end

const HAS_REPL_TRANSFORM = Ref{Bool}(false)
function hook_repl(@nospecialize(repl))
    if HAS_REPL_TRANSFORM[]
        return
    end
    @_debug "installing REPL hook"  time=round(Int, time()*10)
    # Wait for the REPL interface to be set up by `run_frontend` rather than
    # calling `setup_interface` ourselves. Doing it early would ignore user
    # options (e.g. `auto_insert_closing_bracket`) set in other `atreplinit`
    # hooks or startup.jl. Since `hook_repl` runs in its own task (see `try_hook_repl`),
    # we can simply poll here.
    for i in 1:100  # wait up to 10s
        @_debug "wait for REPL interface: $i" time=round(Int, time()*10)
        isdefined(repl, :interface) && break
        sleep(0.1)
    end
    if !isdefined(repl, :interface)
        @warn "VSCodeServer: REPL interface not available after waiting, setting up manually"
        repl.interface = REPL.setup_interface(repl)
    end
    main_mode = get_main_mode(repl)

    if VERSION > v"1.5-"
        for i in 1:20 # repl backend should be set up after 10s -- fall back to the pre-ast-transform approach otherwise
            @_debug "wait for backend: $i" time=round(Int, time()*10)
            has_repl_backend() && break
            sleep(0.5)
        end
        if has_repl_backend()
            @_debug "backend found"  time=round(Int, time()*10)
            # `Base.active_repl_backend` is untyped, so `.ast_transforms` would compile `getproperty` at runtime.
            push!(getfield(Base.active_repl_backend, :ast_transforms), ast -> transform_backend(ast, repl, main_mode))
            HAS_REPL_TRANSFORM[] = true
            @_debug "installing shell integration"  time=round(Int, time()*10)
            install_vscode_shell_integration(main_mode)
            @_debug "REPL AST transform installed"  time=round(Int, time()*10)
            return
        end
    end

    main_mode.on_done = REPL.respond(repl, main_mode; pass_empty = false) do line
        quote
            $(evalrepl)($(active_module)(), $line, $repl, $main_mode)
        end
    end
    @_debug "legacy REPL hook installed"  time=round(Int, time()*10)
    HAS_REPL_TRANSFORM[] = true
    return nothing
end

function try_hook_repl(@nospecialize(repl))
    schedule(Task(BoundCall(hook_repl_or_report, repl)))
end

"""
    hook_repl_or_report(repl)

Install the VS Code integration into `repl`, or report the error if that fails.
"""
function hook_repl_or_report(@nospecialize(repl))
    try
        hook_repl(repl)
    catch err
        report_internal_error(err, catch_backtrace())
        @error "Failed to install rich REPL integration" ex=(err, catch_backtrace())
    end
end

has_repl_backend() = isdefined(Base, :active_repl_backend) && !isnothing(Base.active_repl_backend)

function transform_backend(ast, repl, main_mode)
    quote
        $(evalrepl)($(active_module)(), $(QuoteNode(ast)), $repl, $main_mode)
    end
end

const REPLPromptStates = (
    NoUpdate = 0,
    NoStatus = 1,
    Success = 2,
    Error = 3,
)

const REPL_PROMPT_STATE = Ref{Int}(REPLPromptStates.NoUpdate)
function evalrepl(m, line, repl, main_mode)
    did_notify = false
    return try
        try
            JSONRPC.send_notification(conn_endpoint[], "repl/starteval", nothing)
            did_notify = true
        catch err
            @_debug "Could not send repl/starteval notification" exception = (err, catch_backtrace())
        end
        r = run_with_backend() do
            fix_displays(; is_repl = true)
            f = () -> repleval(m, line, REPL.repl_filename(repl, main_mode.hist))
            PROGRESS_ENABLED[] ? Logging.with_logger(f, VSCodeLogger()) : f()
        end
        REPL_PROMPT_STATE[] = REPLPromptStates.Error
        if r isa EvalError
            # Guarded separately: a broken user `showerror` is not an internal
            # error and must not reach the crash-reporting catch below.
            try
                display_repl_error(stderr, r.err, r.bt)
            catch err
                Base.display_error(stderr, err, catch_backtrace())
            end
            return nothing
        elseif r isa EvalErrorStack
            set_error_global(r)
            try
                display_repl_error(stderr, r)
            catch err
                Base.display_error(stderr, err, catch_backtrace())
            end
            return nothing
        else
            REPL_PROMPT_STATE[] = REPLPromptStates.Success
            return r
        end
    catch err
        # This is for internal errors only; user-code errors were already
        # converted to an `EvalError` above.
        report_internal_error(err, catch_backtrace())
        Base.display_error(stderr, err, catch_backtrace())
        return nothing
    finally
        if did_notify
            try
                JSONRPC.send_notification(conn_endpoint[], "repl/finisheval", nothing)
            catch err
                @_debug "Could not send repl/finisheval notification" exception = (err, catch_backtrace())
            end
        end
    end
end

# don't inline this so we can find it in the stacktrace
@noinline function repleval(m, code::String, file)
    args = VERSION >= v"1.5" ? (REPL.softscope, m, code, file) : (m, code, file)
    return include_string(args...)
end

@noinline function repleval(m, code, _)
    return Base.eval(m, code)
end

replcontext(io, limitflag) = IOContext(
    io,
    :limit => true,
    :displaysize => get(stdout, :displaysize, (60, 120)),
    :stacktrace_types_limited => limitflag,
)

# basically the same as Base's `display_error`, with internal frames removed
display_repl_error(io, err::EvalError; unwrap=false) = display_repl_error(io, err.err, err.bt; unwrap = unwrap)

function display_repl_error(io, err, bt; unwrap = false)
    limitflag = Ref(false)

    st = stacktrace(crop_backtrace(bt))
    printstyled(io, "ERROR: "; bold = true, color = Base.error_color())
    showerror(replcontext(io, limitflag), err, st)
    if limitflag[]
        print(io, "Some type information was truncated. Use `show(err)` to see complete types.")
    end
    println(io)
end

function display_repl_error(io, stack::EvalErrorStack; unwrap = false)
    limitflag = Ref(false)

    printstyled(io, "ERROR: "; bold = true, color = Base.error_color())
    for (i, (err, bt)) in enumerate(reverse(stack.stack))
        i !== 1 && print(io, "\ncaused by: ")
        st = stacktrace(crop_backtrace(bt))
        showerror(replcontext(io, limitflag), unwrap && i == 1 ? unwrap_loaderror(err) : err, st)
        println(io)
    end

    if limitflag[]
        println(io, "Some type information was truncated. Use `show(err)` to see complete types.")
    end
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
