struct InlineDisplay <: AbstractDisplay
    is_repl::Bool
end

InlineDisplay() = InlineDisplay(false)

const PLOT_PANE_ENABLED = Ref(true)
const DIAGNOSTICS_ENABLED = Ref(true)
const INLAY_HINTS_ENABLED = Ref(true)
const PROGRESS_ENABLED = Ref(true)

function toggle_plot_pane_notification(_, params::NamedTuple{(:enable,),Tuple{Bool}})
    PLOT_PANE_ENABLED[] = params.enable
end

function toggle_diagnostics_notification(_, params::NamedTuple{(:enable,),Tuple{Bool}})
    DIAGNOSTICS_ENABLED[] = params.enable
end

function toggle_inlay_hints_notification(_, params::NamedTuple{(:enable,),Tuple{Bool}})
    INLAY_HINTS_ENABLED[] = params.enable
end

function toggle_progress_notification(_, params::NamedTuple{(:enable,),Tuple{Bool}})
    PROGRESS_ENABLED[] = params.enable
end

function fix_displays(; is_repl = false)
    for d in reverse(Base.Multimedia.displays)
        if d isa InlineDisplay
            popdisplay(d)
        end
    end
    pushdisplay(InlineDisplay(is_repl))
end

function with_no_default_display(f; allow_inline = false)
    stack = copy(Base.Multimedia.displays)
    filter!(Base.Multimedia.displays) do d
        !(d isa REPL.REPLDisplay || d isa TextDisplay || (!allow_inline && d isa InlineDisplay))
    end
    try
        return f()
    finally
        empty!(Base.Multimedia.displays)
        foreach(pushdisplay, stack)
    end
end


function sendDisplayMsg(kind, data, id = missing)
    msg = Dict{String,Any}("kind" => kind, "data" => data, "id" => id)
    try
        JSONRPC.send_notification(conn_endpoint[], "display", msg)
        JSONRPC.flush(conn_endpoint[])
    catch
        maybe_queue_notification!("display", msg) || rethrow()
    end
end

function extract_mime_id(m::MIME)
    mime = string(m)
    if !startswith(mime, "application/vnd.julia-vscode")
        return mime, missing
    end
    parts = split(mime, ";")
    if length(parts) === 1
        return mime, missing
    end

    mime, pars = parts
    mat = match(r"\bid=([^,]+)\b", pars)

    if mat !== nothing
        return mime, mat[1]
    end

    return mime, missing
end

function Base.display(d::InlineDisplay, m::MIME, @nospecialize(x))
    if !PLOT_PANE_ENABLED[]
        with_no_default_display(() -> display(m, x))
    else
        mime, id = extract_mime_id(m)
        m = MIME(mime)
        if mime in DISPLAYABLE_MIMES
            # non-`image/...` mime types are not binary
            payload = startswith(mime, "image") ? stringmime(m, x) : String(repr(m, x))
            sendDisplayMsg(mime, payload, id)
        else
            throw(MethodError(display, (d, m, x)))
        end
    end
    return nothing
end

Base.Multimedia.istextmime(::MIME{Symbol("juliavscode/html")}) = true
Base.Multimedia.istextmime(::MIME{Symbol("application/vnd.julia-vscode.plotpane+html")}) = true
Base.Multimedia.istextmime(::MIME{Symbol("application/vnd.julia-vscode.custompane+html")}) = true

Base.Multimedia.displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.dataresource+json")}) = true

function Base.display(::InlineDisplay, m::MIME{Symbol("application/vnd.dataresource+json")}, x)
    payload = String(repr(m, x))
    sendDisplayMsg(string(m), payload)
end

Base.Multimedia.displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.plotly.v1+json")}) = true

function Base.Multimedia.displayable(_::InlineDisplay, mime::MIME)
    if PLOT_PANE_ENABLED[]
        m, _ = extract_mime_id(mime)
        return m in DISPLAYABLE_MIMES
    end
    return false
end

const DISPLAYABLE_MIMES = [
    "application/vnd.vegalite.v5+json",
    "application/vnd.vegalite.v4+json",
    "application/vnd.vegalite.v3+json",
    "application/vnd.vegalite.v2+json",
    "application/vnd.vega.v5+json",
    "application/vnd.vega.v4+json",
    "application/vnd.vega.v3+json",
    "application/vnd.plotly.v1+json",
    "application/vnd.julia-vscode.plotpane+html", # displays html
    "application/vnd.julia-vscode.custompane+html", # displays html in custom pane (metadata via parameter)
    "juliavscode/html", # deprecated
    # "text/html",
    "image/svg+xml",
    "image/png",
    "image/gif",
]

"""
    DIAGNOSTIC_MIME = "application/vnd.julia-vscode.diagnostics"

User type needs to implement a `show` method that returns a named tuple or dictionary like the following
```
Base.show(io::IO, ::MIME"application/vnd.julia-vscode.diagnostics", t::YourType) = (
    source = "Name of my diagnostic tool"
    items = [
        (
            msg = "foo",
            path = "/some/absolute/path.jl",
            line = 1 # 1 based
            range = [[1, 2], [1, 4]] # or [[start_line, start_char], [end_line, end_char]],
            severity = 1, # optional; 0: Error, 1: Warning, 2: Information, 3: Hint
            relatedInformation = [
                (
                    msg = "foobar",
                    path = "/some/other/absolute/path.jl",
                    line = 1,
                    range = [[1, 2], [1, 4]] # or [[start_line, start_char], [end_line, end_char]],
                )
            ] # optional
        ),
        ...
    ]
)
```
One of `line` or `range` needs to be specified for each item and `relatedInformation`.

Anything printed to `io` is discarded.
"""
const DIAGNOSTIC_MIME = "application/vnd.julia-vscode.diagnostics"
Base.Multimedia.displayable(::InlineDisplay, ::MIME{Symbol(DIAGNOSTIC_MIME)}) = DIAGNOSTICS_ENABLED[]
function Base.Multimedia.display(d::InlineDisplay, m::MIME{Symbol(DIAGNOSTIC_MIME)}, diagnostics)
    sendDisplayMsg(DIAGNOSTIC_MIME, show(IOBuffer(), m, diagnostics))
    if d.is_repl
        display(MIME"text/plain"(), diagnostics)
    end
end

"""
    INLAY_HINTS_MIME = "application/vnd.julia-vscode.inlayHints"

User type needs to implement a `show` method that returns a dictionary like the following

```
Base.show(io::IO, ::MIME"application/vnd.julia-vscode.inlayHints", t::YourType) = Dict("/some/other/absolute/path.jl" => [(
    position = (4, 1), # line, column (0 indexed)
    label = "::R",
    kind = 1, # optional; 1: Type, 2: Parameter, nothing: undefined
    tooltip = "test", # optional
    paddingLeft = false, # optional
    paddingRight = false # optional
)])
```

Anything printed to `io` is discarded.
"""
const INLAY_HINTS_MIME = "application/vnd.julia-vscode.inlayHints"
Base.Multimedia.displayable(::InlineDisplay, ::MIME{Symbol(INLAY_HINTS_MIME)}) = INLAY_HINTS_ENABLED[]
function Base.Multimedia.display(d::InlineDisplay, m::MIME{Symbol(INLAY_HINTS_MIME)}, inlay_hints)
    sendDisplayMsg(INLAY_HINTS_MIME, show(IOBuffer(), m, inlay_hints))
    if d.is_repl
        display(MIME"text/plain"(), inlay_hints)
    end
end

function is_table_like(x)
    if showable("application/vnd.dataresource+json", x)
        return true
    end

    istable = Base.invokelatest(_isiterabletable, x)

    if istable === missing || istable === true || x isa AbstractVector || x isa AbstractMatrix
        return true
    end

    return false
end

function can_display(x)
    for mime in DISPLAYABLE_MIMES
        if showable(mime, x)
            return true
        end
    end

    return is_table_like(x)
end

function Base.display(d::InlineDisplay, @nospecialize(x))
    if DIAGNOSTICS_ENABLED[] && showable(DIAGNOSTIC_MIME, x)
        return display(d, DIAGNOSTIC_MIME, x)
    end
    if INLAY_HINTS_ENABLED[] && showable(INLAY_HINTS_MIME, x)
        return display(d, INLAY_HINTS_MIME, x)
    end
    if PLOT_PANE_ENABLED[]
        for mime in DISPLAYABLE_MIMES
            if showable(mime, x)
                return display(d, mime, x)
            end
        end
    else
        return with_no_default_display(() -> display(x))
    end

    throw(MethodError(display, (d, x)))
end

function _display(d::InlineDisplay, x)
    if showable("application/vnd.dataresource+json", x)
        display(d, "application/vnd.dataresource+json", x)
    else
        try
            display(d, x)
        catch err
            if err isa MethodError && err.f === display
                @warn "Cannot display values of type $(typeof(x)) in VS Code."
            else
                rethrow(err)
            end
        end
    end
end

function repl_showingrid_notification(conn, params::NamedTuple{(:code,),Tuple{String}})
    try
        var = Base.invokelatest(Base.include_string, Main, params.code)

        Base.invokelatest(internal_vscodedisplay, var, params.code)
    catch err
        Base.display_error(err, catch_backtrace())
    end
end

function internal_vscodedisplay(x, title::AbstractString = "")
    if is_table_like(x)
        showtable(x, title)
    else
        _display(InlineDisplay(), x)
    end
end

vscodedisplay(x, title::AbstractString = "") = internal_vscodedisplay(x, title)
vscodedisplay(title::AbstractString) = i -> vscodedisplay(i, title)
macro vscodedisplay(x)
    :(vscodedisplay($(esc(x)), $(string(x))))
end
