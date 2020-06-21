
const INLINE_RESULT_LENGTH = 100
const MAX_RESULT_LENGTH = 10_000


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
        str,
        false
    )
end

function render(::Nothing)
    return ReplRunCodeRequestReturn(
        "✓",
        "nothing",
        false
    )
end

struct EvalError
    err
    bt
end

function render(err::EvalError)
    str = sprintlimited(err.err, err.bt, func=Base.display_error, limit=MAX_RESULT_LENGTH)

    return ReplRunCodeRequestReturn(
        strlimit(first(split(str, "\n")), limit=INLINE_RESULT_LENGTH),
        str,
        true
    )
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
