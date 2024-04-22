# Most of the code here is copied from the Juno codebase

using REPL
using REPL.LineEdit

const ENABLE_SHELL_INTEGRATION = Ref{Bool}(false)

isREPL() = isdefined(Base, :active_repl) &&
           isdefined(Base.active_repl, :interface) &&
           isdefined(Base.active_repl.interface, :modes) &&
           isdefined(Base.active_repl, :mistate) &&
           isdefined(Base.active_repl.mistate, :current_mode)

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
    elseif applicable(LineEdit.write_prompt, stdout, mode, true)
        LineEdit.write_prompt(stdout, mode, true)
    elseif mode isa LineEdit.PrefixHistoryPrompt || :parent_prompt in fieldnames(typeof(mode))
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

si(f) = (args...) -> ENABLE_SHELL_INTEGRATION[] ? f(args...) : ""

function sanitize_shell_integration_string(cmd)
    replace(replace(replace(cmd, "\n" => "<LF>"), ";" => "<CL>"), "\a" => "<ST>")
end

const SHELL = (
    prompt_start = si(() -> "\e]633;A\a"),
    prompt_end = si(() -> "\e]633;B\a"),
    output_start = si(() -> "\e]633;C\a"),
    output_end = si(function ()
        if REPL_PROMPT_STATE[] === REPLPromptStates.NoUpdate
            return ""
        elseif REPL_PROMPT_STATE[] === REPLPromptStates.NoStatus
            REPL_PROMPT_STATE[] = REPLPromptStates.NoUpdate
            return "\e]633;D\a"
        else
            exitcode = REPL_PROMPT_STATE[] == REPLPromptStates.Error
            REPL_PROMPT_STATE[] = REPLPromptStates.NoUpdate
            return "\e]633;D;$(Int(exitcode))\a"
        end
    end),
    update_cmd = si(function (cmd)
        cmd = sanitize_shell_integration_string(cmd)
        "\e]633;E;$cmd\a"
    end),
    continuation_prompt_start = si(() -> "\e]633;F\a"),
    continuation_prompt_end = si(() -> "\e]633;G\a"),
    update_cwd = si(() -> "\e]633;P;Cwd=$(pwd())\a"),
    windows_compat = si(() -> "\e]633;P;IsWindows=True\a")
)

as_func(x) = () -> x
as_func(x::Function) = x

function install_vscode_shell_integration(prompt)
    if Sys.iswindows()
        print(stdout, SHELL.windows_compat())
    end
    prefix = as_func(prompt.prompt_prefix)
    suffix = as_func(prompt.prompt_suffix)
    prompt.prompt_prefix = () -> string(SHELL.output_end(), SHELL.prompt_start(), prefix())
    prompt.prompt_suffix = () -> string(suffix(), SHELL.update_cwd(), SHELL.prompt_end())

    on_done = prompt.on_done
    prompt.on_done = function (mi, buf, ok)
        print(stdout, SHELL.output_start(), SHELL.update_cmd(String(take!(deepcopy(buf)))))
        REPL_PROMPT_STATE[] = REPLPromptStates.NoStatus
        on_done(mi, buf, ok)
    end
end

if VERSION > v"1.9-"
    active_module = Base.active_module
else
    active_module() = Main
end

const HAS_REPL_TRANSFORM = Ref{Bool}(false)
function hook_repl(repl)
    if HAS_REPL_TRANSFORM[]
        return
    end
    @debug "installing REPL hook"
    if !isdefined(repl, :interface)
        repl.interface = REPL.setup_interface(repl)
    end
    main_mode = get_main_mode(repl)

    if VERSION > v"1.5-"
        for _ = 1:20 # repl backend should be set up after 10s -- fall back to the pre-ast-transform approach otherwise
            isdefined(Base, :active_repl_backend) && continue
            sleep(0.5)
        end
        if isdefined(Base, :active_repl_backend)
            push!(Base.active_repl_backend.ast_transforms, ast -> transform_backend(ast, repl, main_mode))
            HAS_REPL_TRANSFORM[] = true
            install_vscode_shell_integration(main_mode)
            @debug "REPL AST transform installed"
            return
        end
    end

    main_mode.on_done = REPL.respond(repl, main_mode; pass_empty = false) do line
        quote
            $(evalrepl)($(active_module)(), $line, $repl, $main_mode)
        end
    end
    @debug "legacy REPL hook installed"
    HAS_REPL_TRANSFORM[] = true
    return nothing
end

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
            @debug "Could not send repl/starteval notification" exception = (err, catch_backtrace())
        end
        r = run_with_backend() do
            fix_displays(; is_repl = true)
            f = () -> repleval(m, line, REPL.repl_filename(repl, main_mode.hist))
            PROGRESS_ENABLED[] ? Logging.with_logger(f, VSCodeLogger()) : f()
        end
        REPL_PROMPT_STATE[] = REPLPromptStates.Error
        if r isa EvalError
            display_repl_error(stderr, r.err, r.bt)
            nothing
        elseif r isa EvalErrorStack
            set_error_global(r)
            display_repl_error(stderr, r)
            nothing
        else
            REPL_PROMPT_STATE[] = REPLPromptStates.Success
            r
        end
    catch err
        # This is for internal errors only.
        Base.display_error(stderr, err, catch_backtrace())
        nothing
    finally
        if did_notify
            try
                JSONRPC.send_notification(conn_endpoint[], "repl/finisheval", nothing)
            catch err
                @debug "Could not send repl/finisheval notification" exception = (err, catch_backtrace())
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
