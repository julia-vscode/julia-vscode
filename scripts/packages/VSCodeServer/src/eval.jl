const INLINE_RESULT_LENGTH = 100
const MAX_RESULT_LENGTH = 10_000

# Workaround for https://github.com/julia-vscode/julia-vscode/issues/1940
struct Wrapper
    content::Any
end
wrap(x) = Wrapper(x)
unwrap(x) = x.content

const EVAL_CHANNEL_IN = Channel(0)
const EVAL_CHANNEL_OUT = Channel(0)
const EVAL_BACKEND_TASK = Ref{Any}(nothing)
const IS_BACKEND_WORKING = Ref{Bool}(false)

function is_evaling()
    return IS_BACKEND_WORKING[]
end

function run_with_backend(f, args...)
    put!(EVAL_CHANNEL_IN, (f, args))
    return unwrap(take!(EVAL_CHANNEL_OUT))
end

function start_eval_backend()
    global EVAL_BACKEND_TASK[] = @async begin
        Base.sigatomic_begin()
        while true
            try
                f, args = take!(EVAL_CHANNEL_IN)
                Base.sigatomic_end()
                IS_BACKEND_WORKING[] = true
                res = try
                    Base.invokelatest(f, args...)
                catch err
                    @static if isdefined(Base, :current_exceptions)
                        EvalErrorStack(Base.current_exceptions(current_task()))
                    elseif isdefined(Base, :catch_stack)
                        EvalErrorStack(Base.catch_stack())
                    else
                        EvalError(err, catch_backtrace())
                    end
                end
                IS_BACKEND_WORKING[] = false
                Base.sigatomic_begin()
                put!(EVAL_CHANNEL_OUT, wrap(res))
            catch err
                put!(EVAL_CHANNEL_OUT, wrap(err))
            finally
                IS_BACKEND_WORKING[] = false
            end
        end
        Base.sigatomic_end()
    end
end

function repl_interrupt_request(conn, ::Nothing)
    println(stderr, "^C")
    if EVAL_BACKEND_TASK[] !== nothing && !istaskdone(EVAL_BACKEND_TASK[]) && IS_BACKEND_WORKING[]
        schedule(EVAL_BACKEND_TASK[], InterruptException(); error = true)
    end
end

# https://github.com/JuliaLang/julia/blob/53a781d399bfb517b554fb1ae106e6dac99205f1/stdlib/REPL/src/REPL.jl#L547
function add_code_to_repl_history(code)
    code = strip(code)
    isempty(code) && return

    try
        mode = get_main_mode()
        hist = mode.hist
        !isempty(hist.history) &&
            isequal(:julia, hist.modes[end]) && code == hist.history[end] && return

        hist.last_mode = mode
        hist.last_buffer = let
            io = IOBuffer()
            print(io, code)
            io
        end
        push!(hist.modes, :julia)
        push!(hist.history, code)
        hist.history_file === nothing && return
        entry = """
        # time: $(Libc.strftime("%Y-%m-%d %H:%M:%S %Z", time()))
        # mode: julia
        $(replace(code, r"^"ms => "\t"))
        """
        seekend(hist.history_file)
        print(hist.history_file, entry)
        flush(hist.history_file)

        hist.cur_idx = length(hist.history) + 1
    catch err
        @error "writing to history failed" exception = (err, catch_backtrace())
    end
end

CAN_SET_ANS = Ref{Bool}(true)
CAN_SET_ERR = Ref{Bool}(true)

function set_error_global(errs)
    if CAN_SET_ERR[]
        try
            errs isa EvalErrorStack || error()
            istrivial = @static if isdefined(Base, :istrivialerror)
                Base.istrivialerror(errs.stack)
            else
                true
            end
            @static if VERSION > v"1.10-"
                istrivial || setglobal!(Base.MainInclude, :err, errs.stack)
            elseif @isdefined setglobal!
                istrivial || setglobal!(Main, :err, errs.stack)
            else
                istrivial || ccall(:jl_set_global, Cvoid, (Any, Any, Any), Main, :err, errs.stack)
            end
        catch
            CAN_SET_ERR[] = false
        end
    end
end

function repl_runcode_request(conn, params::ReplRunCodeRequestParams)::ReplRunCodeRequestReturn
    run_with_backend() do
        fix_displays()

        source_filename = params.filename
        code_line = params.line
        code_column = params.column
        source_code = params.code
        mod = params.mod

        resolved_mod = try
            module_from_string(mod)
        catch err
            # maybe trigger error reporting here
            Main
        end

        show_code = params.showCodeInREPL
        show_result = params.showResultInREPL
        show_error = params.showErrorInREPL
        try
            JSONRPC.send_notification(conn_endpoint[], "repl/starteval", nothing)
        catch err
            @debug "Could not send repl/starteval notification."
        end

        f = () -> hideprompt() do
            revise()

            if show_code
                add_code_to_repl_history(source_code)

                prompt = "julia> "
                prefix = string(SHELL.output_end(), SHELL.prompt_start(), "\e[32m\e[1m")
                suffix = string("\e[0m", SHELL.update_cwd(), SHELL.prompt_end())
                try
                    mode = get_main_mode()
                    prompt = LineEdit.prompt_string(mode.prompt)
                    LineEdit.write_prompt(stdout, mode)
                catch err
                    print(stdout, prefix, prompt, suffix)
                    @debug "getting prompt info failed" exception = (err, catch_backtrace())
                end

                for (i, line) in enumerate(eachline(IOBuffer(source_code)))
                    i != 1 && print(' '^length(prompt))
                    print(' '^code_column)
                    println(line)
                end

                print(stdout, SHELL.output_start())
                print(stdout, SHELL.update_cmd(source_code))
                REPL_PROMPT_STATE[] = REPLPromptStates.NoStatus
            end

            return withpath(source_filename) do
                res = try
                    val = inlineeval(resolved_mod, source_code, code_line, code_column, source_filename, softscope = params.softscope)
                    if CAN_SET_ANS[]
                        try
                            @static if VERSION > v"1.10-"
                                setglobal!(Base.MainInclude, :ans, val)
                            elseif @isdefined setglobal!
                                setglobal!(Main, :ans, val)
                            else
                                ccall(:jl_set_global, Cvoid, (Any, Any, Any), Main, :ans, val)
                            end
                        catch _
                            CAN_SET_ANS[] = false
                        end
                    end
                    if show_code
                        REPL_PROMPT_STATE[] = REPLPromptStates.Success
                    end
                    val
                catch err
                    if show_code
                        REPL_PROMPT_STATE[] = REPLPromptStates.Error
                    end
                    errs = @static if isdefined(Base, :current_exceptions)
                        EvalErrorStack(Base.current_exceptions(current_task()))
                    elseif isdefined(Base, :catch_stack)
                        EvalErrorStack(Base.catch_stack())
                    else
                        EvalError(err, catch_backtrace())
                    end

                    set_error_global(errs)

                    errs
                finally
                    try
                        JSONRPC.send_notification(conn_endpoint[], "repl/finisheval", nothing)
                    catch err
                        @debug "Could not send repl/finisheval notification."
                    end
                end

                if show_error && (res isa EvalError || res isa EvalErrorStack)
                    try
                        display_repl_error(stderr, res; unwrap=true)
                    catch err
                        Base.display_error(stderr, err, catch_backtrace())
                    end
                elseif show_result
                    if res isa EvalError || res isa EvalErrorStack
                        try
                            display_repl_error(stderr, res; unwrap=true)
                        catch err
                            Base.display_error(stderr, err, catch_backtrace())
                        end
                    elseif res !== nothing && !ends_with_semicolon(source_code)
                        try
                            Base.invokelatest(display, res)
                        catch err
                            Base.display_error(stderr, err, catch_backtrace())
                        end
                    end
                else
                    try
                        if !ends_with_semicolon(source_code) && !(res isa EvalError || res isa EvalErrorStack)
                            with_no_default_display(() -> display(res); allow_inline = true)
                        end
                    catch err
                        if !(err isa MethodError && err.f === display)
                            printstyled(stderr, "Display Error: ", color = Base.error_color(), bold = true)
                            Base.display_error(stderr, err, catch_backtrace())
                        end
                    end
                end

                if !(res isa EvalError || res isa EvalErrorStack) && ends_with_semicolon(source_code)
                    res = nothing
                end

                return safe_render(res)
            end
        end

        return PROGRESS_ENABLED[] ? Logging.with_logger(f, VSCodeLogger()) : f()
    end
end

# don't inline this so we can find it in the stacktrace
@noinline function inlineeval(m, code, code_line, code_column, file; softscope = false)
    code = string('\n'^code_line, ' '^code_column, code)
    args = softscope && VERSION >= v"1.5" ? (REPL.softscope, m, code, file) : (m, code, file)
    return Base.invokelatest(include_string, args...)
end

"""
    safe_render(x)

Calls `render`, but catches errors in the display system.
"""
function safe_render(x)::ReplRunCodeRequestReturn
    try
        return render(x)
    catch err
        out = render(EvalError(err, catch_backtrace()))

        return ReplRunCodeRequestReturn(
            string("Display Error: ", out.inline),
            string("Display Error: ", out.all),
            out.stackframe
        )
    end
end

"""
    render(x)

Produce a representation of `x` that can be displayed by a UI.
Must return a `ReplRunCodeRequestReturn` with the following fields:
- `inline::String`: Short one-line plain text representation of `x`. Typically limited to `INLINE_RESULT_LENGTH` characters.
- `all::String`: Plain text string (that may contain linebreaks and other signficant whitespace) to further describe `x`.
- `stackframe::Vector{Frame}`: Optional, should only be given on an error
"""
function render(x)::ReplRunCodeRequestReturn
    plain = sprintlimited(MIME"text/plain"(), x, limit = MAX_RESULT_LENGTH)
    md = try
        sprintlimited(MIME"text/markdown"(), x, limit = MAX_RESULT_LENGTH)
    catch _
        codeblock(plain)
    end
    inline = strlimit(first(split(plain, "\n")), limit = INLINE_RESULT_LENGTH)
    return ReplRunCodeRequestReturn(inline, md)
end

render(::Nothing)::ReplRunCodeRequestReturn = ReplRunCodeRequestReturn("✓", codeblock("nothing"))

codeblock(s) = string("```\n", s, "\n```")

struct EvalError
    err::Any
    bt::Any
end

struct EvalErrorStack
    stack::Any
end

sprint_error_unwrap(err) = sprint_error(unwrap_loaderror(err))

unwrap_loaderror(err::LoadError) = err.error
unwrap_loaderror(err) = err

function sprint_error(err)
    sprintlimited(err, [], func = Base.display_error, limit = MAX_RESULT_LENGTH)
end

function render(err::EvalError)::ReplRunCodeRequestReturn
    bt = crop_backtrace(err.bt)

    errstr = sprint_error_unwrap(err.err)
    inline = strlimit(first(split(errstr, "\n")), limit = INLINE_RESULT_LENGTH)
    all = string('\n', codeblock(errstr), '\n', backtrace_string(bt))

    # handle duplicates e.g. from recursion
    st = unique!(remove_kw_wrappers!(stacktrace(bt)))
    # limit number of potential hovers shown in VSCode, just in case
    st = st[1:min(end, 1000)]

    stackframe = Frame.(st)
    return ReplRunCodeRequestReturn(inline, all, stackframe)
end

function render(stack::EvalErrorStack)::ReplRunCodeRequestReturn
    inline = ""
    all = ""
    complete_bt = Union{Base.InterpreterIP,Ptr{Cvoid}}[]
    for (i, (err, bt)) in enumerate(reverse(stack.stack))
        bt = crop_backtrace(bt)
        append!(complete_bt, bt)

        errstr = sprint_error_unwrap(err)
        inline *= strlimit(first(split(errstr, "\n")), limit = INLINE_RESULT_LENGTH)
        all *= string('\n', codeblock(errstr), '\n', backtrace_string(bt))
    end

    # handle duplicates e.g. from recursion
    st = unique!(remove_kw_wrappers!(stacktrace(complete_bt)))
    # limit number of potential hovers shown in VSCode, just in case
    st = st[1:min(end, 1000)]

    stackframe = Frame.(st)
    return ReplRunCodeRequestReturn(inline, all, stackframe)
end

function Base.display_error(io::IO, err::EvalError)
    try
        Base.invokelatest(display_repl_error, io, unwrap_loaderror(err.err), err.bt)
    catch err
        @error "Error trying to display an error." ex = (err, catch_backtrace())
    end
end

function Base.display_error(io::IO, err::EvalErrorStack)
    try
        Base.invokelatest(display_repl_error, io, err)
    catch err
        @error "Error trying to display an error." ex = (err, catch_backtrace())
    end
end

function remove_kw_wrappers!(st::StackTraces.StackTrace)
    filter!(st) do frame
        fname = string(frame.func)
        return !(!startswith(fname, '#') && endswith(fname, "##kw"))
    end

    return st
end

function backtrace_string(bt)
    limitflag = Ref(false)

    iob = IOBuffer()
    io = IOContext(
        iob,
        :stacktrace_types_limited => limitflag,
        :displaysize => (120, 120)
    )

    println(io, "Stacktrace:\n")
    i = 1
    counter = 1
    stack = remove_kw_wrappers!(stacktrace(bt))

    while i <= length(stack)
        if counter > 200
            println(io, "\n\n truncated")
            break
        end

        frame, repeated = stack[i], 1
        while i < length(stack) && stack[i+1] == frame
            i += 1
            repeated += 1
        end

        file = string(frame.file)
        full_file = fullpath(something(Base.find_source_file(file), file))
        cmd = vscode_cmd_uri("language-julia.openFile"; path = full_file, line = frame.line)

        print(io, counter, ". `")
        Base.StackTraces.show_spec_linfo(io, frame)
        print(io, "` at [", basename(file), "](", cmd, " \"", file, "\")")
        if repeated > 1
            print(io, " (repeats $repeated times)")
        end
        println(io, "\n")
        i += 1
        counter += 1
    end

    if limitflag[]
        print(io, "Some type information was truncated. Use `show(err)` to see complete types.")
    end

    return String(take!(iob))
end
