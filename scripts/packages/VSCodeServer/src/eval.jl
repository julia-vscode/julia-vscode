const INLINE_RESULT_LENGTH = 100
const MAX_RESULT_LENGTH = 10_000

const EVAL_CHANNEL_IN = Channel(0)
const EVAL_CHANNEL_OUT = Channel(0)
const EVAL_BACKEND_TASK = Ref{Any}(nothing)
const IS_BACKEND_WORKING = Ref{Bool}(false)

function is_evaling()
  return IS_BACKEND_WORKING[]
end

function run_with_backend(f, args...)
  put!(EVAL_CHANNEL_IN, (f, args))
  return take!(EVAL_CHANNEL_OUT)
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
            EvalError(err, catch_backtrace())
        end
        IS_BACKEND_WORKING[] = false
        Base.sigatomic_begin()
        put!(EVAL_CHANNEL_OUT, res)
      catch err
        put!(EVAL_CHANNEL_OUT, err)
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
        @error "writing to history failed" exception=(err, catch_backtrace())
    end
end

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

        JSONRPC.send_notification(conn_endpoint[], "repl/starteval", nothing)

        rendered_result = nothing
        Logging.with_logger(VSCodeLogger()) do
            hideprompt() do
                if isdefined(Main, :Revise) && isdefined(Main.Revise, :revise) && Main.Revise.revise isa Function
                    let mode = get(ENV, "JULIA_REVISE", "auto")
                        mode == "auto" && Main.Revise.revise()
                    end
                end
                if show_code
                    add_code_to_repl_history(source_code)

                    prompt = "julia> "
                    prefix = "\e[32m"
                    try
                        mode = get_main_mode()
                        prompt = mode.prompt
                        prefix = mode.prompt_prefix
                    catch err
                        @debug "getting prompt info failed" exception=(err, catch_backtrace())
                    end

                    for (i,line) in enumerate(eachline(IOBuffer(source_code)))
                        if i==1
                            print(prefix, prompt, "\e[0m")
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
                        ans = inlineeval(resolved_mod, source_code, code_line, code_column, source_filename, softscope = params.softscope)
                        @eval Main ans = $(QuoteNode(ans))
                    catch err
                        EvalError(err, catch_backtrace())
                    finally
                        JSONRPC.send_notification(conn_endpoint[], "repl/finisheval", nothing)
                    end

                    if show_result
                        if res isa EvalError
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
                            Base.invokelatest(display, InlineDisplay(), res)
                        catch err
                            if !(err isa MethodError)
                                printstyled(stderr, "Display Error: ", color = Base.error_color(), bold = true)
                                Base.display_error(stderr, err, catch_backtrace())
                            end
                        end
                    end

                    rendered_result = safe_render(res)
                end
            end
        end
        return rendered_result
    end
end

# don't inline this so we can find it in the stacktrace
@noinline function inlineeval(m, code, code_line, code_column, file; softscope = false)
    code = string('\n' ^ code_line, ' ' ^ code_column, code)
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
    str = sprintlimited(MIME"text/plain"(), x, limit=MAX_RESULT_LENGTH)
    inline = strlimit(first(split(str, "\n")), limit=INLINE_RESULT_LENGTH)
    all = codeblock(str)
    return ReplRunCodeRequestReturn(inline, all)
end

render(::Nothing) = ReplRunCodeRequestReturn("✓", codeblock("nothing"))

indent4(s) = string(' ' ^ 4, s)
codeblock(s) = joinlines(indent4.(splitlines(s)))

struct EvalError
    err
    bt
end

sprint_error_unwrap(err::LoadError) = sprint_error(err.error)
sprint_error_unwrap(err) = sprint_error(err)

function sprint_error(err)
    sprintlimited(err, [], func = Base.display_error, limit = MAX_RESULT_LENGTH)
end

function render(err::EvalError)
    bt = crop_backtrace(err.bt)

    errstr = sprint_error_unwrap(err.err)
    inline = strlimit(first(split(errstr, "\n")), limit = INLINE_RESULT_LENGTH)
    all = string('\n', codeblock(errstr), '\n', backtrace_string(bt))

    # handle duplicates e.g. from recursion
    st = unique!(stacktrace(bt))
    # limit number of potential hovers shown in VSCode, just in case
    st = st[1:min(end, 1000)]

    stackframe = Frame.(st)
    return ReplRunCodeRequestReturn(inline, all, stackframe)
end

function Base.display_error(io::IO, err::EvalError)
    bt = crop_backtrace(err.bt)

    try
        Base.invokelatest(Base.display_error, io, err.err, bt)
    catch err
    end
end

function crop_backtrace(bt)
    i = find_frame_index(bt, @__FILE__, inlineeval)
    # NOTE:
    # `4` corresponds to the number of function calls between `inlineeval` to the user code (, which was invoked by `include_string`),
    # i.e. `inlineeval`, `Base.invokelatest`, `Base.invokelatest` (the method instance with keyword args handled), and `include_string`
    return bt[1:(i === nothing ? end : i - 4)]
end

# more cleaner way ?
const LOCATION_REGEX = r"\[\d+\]\s(?<body>.+)\sat\s(?<path>.+)\:(?<line>\d+)"

function backtrace_string(bt)
    s = sprintlimited(bt, func = Base.show_backtrace, limit = MAX_RESULT_LENGTH)
    lines = strip.(split(s, '\n'))

    return join(map(enumerate(lines)) do (i, line)
        i === 1 && return line # "Stacktrace:"
        m = match(LOCATION_REGEX, line)
        m === nothing && return line
        linktext = string(m[:path], ':', m[:line])
        linkbody = vscode_cmd_uri("language-julia.openFile"; path = fullpath(m[:path]), line = m[:line])
        linktitle = string("Go to ", linktext)
        return "$(i-1). `$(m[:body])` at [$(linktext)]($(linkbody) \"$(linktitle)\")"
    end, "\n\n")
end
