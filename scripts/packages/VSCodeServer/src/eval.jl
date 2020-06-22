const INLINE_RESULT_LENGTH = 100
const MAX_RESULT_LENGTH = 10_000

function repl_runcode_request(conn, params::ReplRunCodeRequestParams)
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

    rendered_result = nothing

    hideprompt() do
        if isdefined(Main, :Revise) && isdefined(Main.Revise, :revise) && Main.Revise.revise isa Function
            let mode = get(ENV, "JULIA_REVISE", "auto")
                mode == "auto" && Main.Revise.revise()
            end
        end
        if show_code
            for (i,line) in enumerate(eachline(IOBuffer(source_code)))
                if i==1
                    printstyled("julia> ", color=:green)
                    print(' '^code_column)
                else
                    # Indent by 7 so that it aligns with the julia> prompt
                    print(' '^7)
                end

                println(line)
            end
        end

        withpath(source_filename) do
            res = try
                ans = inlineeval(resolved_mod, source_code, code_line, code_column, source_filename)
                @eval Main ans = $(QuoteNode(ans))
            catch err
                EvalError(err, catch_backtrace())
            end

            if show_result
                if res isa EvalError
                    Base.display_error(stderr, res.err, res.bt)
                elseif res !== nothing && !ends_with_semicolon(source_code)
                    Base.invokelatest(display, res)
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
    return rendered_result
end

# don't inline this so we can find it in the stacktrace
@noinline function inlineeval(m, code, code_line, code_column, file)
    code = string('\n' ^ code_line, ' ' ^ code_column, code)
    return Base.invokelatest(include_string, m, code, file)
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
            out.iserr
        )
    end
end

"""
    render(x)

Produce a representation of `x` that can be displayed by a UI. Must return a dictionary with
the following fields:
- `inline`: Short one-line plain text representation of `x`. Typically limited to `INLINE_RESULT_LENGTH` characters.
- `all`: Plain text string (that may contain linebreaks and other signficant whitespace) to further describe `x`.
- `iserr`: Boolean. The frontend may style the UI differently depending on this value.
"""
function render(x)
    str = sprintlimited(MIME"text/plain"(), x, limit=MAX_RESULT_LENGTH)

    return ReplRunCodeRequestReturn(
        strlimit(first(split(str, "\n")), limit=INLINE_RESULT_LENGTH),
        str
    )
end

function render(::Nothing)
    return ReplRunCodeRequestReturn("✓", "nothing")
end

struct EvalError
    err
    bt
end

function render(err::EvalError)
    bt = err.bt
    i = find_frame_index(bt, @__FILE__, inlineeval)
    bt = bt[1:(i === nothing ? end : i - 4)]
    st = stacktrace(bt)
    str = sprintlimited(err.err, bt, func = Base.display_error, limit = MAX_RESULT_LENGTH)
    return ReplRunCodeRequestReturn(
        strlimit(first(split(str, "\n")), limit = INLINE_RESULT_LENGTH),
        str,
        Frame.(st)
    )
end
