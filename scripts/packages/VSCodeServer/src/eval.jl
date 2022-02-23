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

ans = nothing
function repl_runcode_request(conn, params::ReplRunCodeRequestParams)
    return run_with_backend() do
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

        JSONRPC.send_notification(conn_endpoint[], "repl/starteval", nothing)

        rendered_result = nothing
        f = () -> hideprompt() do
            revise()

            if show_code
                add_code_to_repl_history(source_code)

                prompt = "julia> "
                prefix = "\e[32m"
                try
                    mode = get_main_mode()
                    prompt = mode.prompt
                    prefix = mode.prompt_prefix
                catch err
                    @debug "getting prompt info failed" exception = (err, catch_backtrace())
                end

                for (i, line) in enumerate(eachline(IOBuffer(source_code)))
                    if i == 1
                        print(prefix, "\e[1m", prompt, "\e[0m")
                        print(' '^code_column)
                    else
                        # Indent by 7 so that it aligns with the julia> prompt
                        print(' '^length(prompt))
                    end

                    println(line)
                end
            end

            withpath(source_filename) do
                res = try
                    global ans = inlineeval(resolved_mod, source_code, code_line, code_column, source_filename, softscope = params.softscope)
                    @eval Main ans = Main.VSCodeServer.ans
                catch err
                    @static if isdefined(Base, :current_exceptions)
                        EvalErrorStack(Base.current_exceptions(current_task()))
                    elseif isdefined(Base, :catch_stack)
                        EvalErrorStack(Base.catch_stack())
                    else
                        EvalError(err, catch_backtrace())
                    end
                finally
                    JSONRPC.send_notification(conn_endpoint[], "repl/finisheval", nothing)
                end

                if show_error && res isa EvalError || res isa EvalErrorStack
                    Base.display_error(stderr, res)
                elseif show_result
                    if res isa EvalError || res isa EvalErrorStack
                        Base.display_error(stderr, res)
                    elseif res !== nothing && !ends_with_semicolon(source_code)
                        try
                            Base.invokelatest(display, res)
                        catch err
                            Base.display_error(stderr, err, catch_backtrace())
                        end
                    end
                else
                    try
                        if !ends_with_semicolon(source_code)
                            Base.invokelatest(display, InlineDisplay(), res)
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

                rendered_result = safe_render(res)
            end
        end
        PROGRESS_ENABLED[] ? Logging.with_logger(f, VSCodeLogger()) : f()

        return rendered_result
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
function safe_render(x)
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
function render(x)
    str = sprintlimited(MIME"text/plain"(), x, limit = MAX_RESULT_LENGTH)
    inline = strlimit(first(split(str, "\n")), limit = INLINE_RESULT_LENGTH)
    all = codeblock(str)
    return ReplRunCodeRequestReturn(inline, all)
end

render(::Nothing) = ReplRunCodeRequestReturn("✓", codeblock("nothing"))

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

function render(err::EvalError)
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

function render(stack::EvalErrorStack)
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
        @error "Error trying to display an error."
    end
end

function Base.display_error(io::IO, err::EvalErrorStack)
    try
        Base.invokelatest(display_repl_error, io, err)
    catch err
        @error "Error trying to display an error."
    end
end

function crop_backtrace(bt)
    i = find_first_topelevel_scope(bt)
    return bt[1:(i === nothing ? end : i)]
end

function remove_kw_wrappers!(st::StackTraces.StackTrace)
    filter!(st) do frame
        fname = string(frame.func)
        return !(!startswith(fname, '#') && endswith(fname, "##kw"))
    end

    return st
end

function backtrace_string(bt)
    io = IOBuffer()

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
        print(io, "` at [", file, "](", cmd, " \"", file, "\")")
        if repeated > 1
            print(io, " (repeats $repeated times)")
        end
        println(io, "\n")
        i += 1
        counter += 1
    end

    return String(take!(io))
end
