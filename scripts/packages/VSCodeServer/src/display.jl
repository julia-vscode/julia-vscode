struct InlineDisplay <: AbstractDisplay end

const PLOT_PANE_ENABLED = Ref(true)
const DIAGNOSTICS_ENABLED = Ref(true)
const PROGRESS_ENABLED = Ref(true)

function toggle_plot_pane(_, params::NamedTuple{(:enable,),Tuple{Bool}})
    PLOT_PANE_ENABLED[] = params.enable
end

function toggle_diagnostics(_, params::NamedTuple{(:enable,),Tuple{Bool}})
    DIAGNOSTICS_ENABLED[] = params.enable
end

function toggle_progress(_, params::NamedTuple{(:enable,),Tuple{Bool}})
    PROGRESS_ENABLED[] = params.enable
end

function fix_displays()
    for d in reverse(Base.Multimedia.displays)
        if d isa InlineDisplay
            popdisplay(InlineDisplay())
        end
    end
    pushdisplay(InlineDisplay())
end

function with_no_default_display(f)
    stack = copy(Base.Multimedia.displays)
    filter!(Base.Multimedia.displays) do d
        !(d isa REPL.REPLDisplay || d isa TextDisplay || d isa InlineDisplay)
    end
    try
        return f()
    finally
        empty!(Base.Multimedia.displays)
        foreach(pushdisplay, stack)
    end
end

function sendDisplayMsg(kind, data)
    JSONRPC.send_notification(conn_endpoint[], "display", Dict{String,Any}("kind" => kind, "data" => data))
    JSONRPC.flush(conn_endpoint[])
end

function Base.display(d::InlineDisplay, m::MIME, x)
    if !PLOT_PANE_ENABLED[]
        with_no_default_display(() -> display(m, x))
    else
        mime = string(m)
        if mime in DISPLAYABLE_MIMES
            # we now all except for `image/...` mime types are not binary
            payload = startswith(mime, "image") ? stringmime(m, x) : String(repr(m, x))
            sendDisplayMsg(mime, payload)
        else
            throw(MethodError(display, (d, m, x)))
        end
    end
    return nothing
end

Base.Multimedia.istextmime(::MIME{Symbol("juliavscode/html")}) = true

Base.Multimedia.displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.dataresource+json")}) = true

function Base.display(d::InlineDisplay, m::MIME{Symbol("application/vnd.dataresource+json")}, x)
    payload = String(repr(m, x))
    sendDisplayMsg(string(m), payload)
end

Base.Multimedia.displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.plotly.v1+json")}) = true

Base.Multimedia.displayable(_::InlineDisplay, mime::MIME) = PLOT_PANE_ENABLED[] && string(mime) in DISPLAYABLE_MIMES

const DISPLAYABLE_MIMES = [
    "application/vnd.vegalite.v4+json",
    "application/vnd.vegalite.v3+json",
    "application/vnd.vegalite.v2+json",
    "application/vnd.vega.v5+json",
    "application/vnd.vega.v4+json",
    "application/vnd.vega.v3+json",
    "application/vnd.plotly.v1+json",
    "juliavscode/html",
    # "text/html",
    "image/svg+xml",
    "image/png",
    "image/gif"
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
Base.Multimedia.display(::InlineDisplay, m::MIME{Symbol(DIAGNOSTIC_MIME)}, diagnostics) = sendDisplayMsg(DIAGNOSTIC_MIME, show(IOBuffer(), m, diagnostics))

function can_display(x)
    for mime in DISPLAYABLE_MIMES
        if showable(mime, x)
            return true
        end
    end

    if showable("application/vnd.dataresource+json", x)
        return true
    end

    istable = Base.invokelatest(_isiterabletable, x)

    if istable === missing || istable === true || x isa AbstractVector || x isa AbstractMatrix
        return true
    end

    return false
end

function Base.display(d::InlineDisplay, x)
    if DIAGNOSTICS_ENABLED[] && showable(DIAGNOSTIC_MIME, x)
        return display(d, DIAGNOSTIC_MIME, x)
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

const tabletraits_uuid = UUIDs.UUID("3783bdb8-4a98-5b6b-af9a-565f29a5fe9c")
const datavalues_uuid = UUIDs.UUID("e7dc6d0d-1eca-5fa6-8ad6-5aecde8b7ea5")

global _isiterabletable = i -> false
global _getiterator = i -> i

function pkgload(pkg)
    if pkg.uuid == tabletraits_uuid
        x = Base.require(pkg)

        global _isiterabletable = x.isiterabletable
        global _getiterator = x.getiterator
    elseif pkg.uuid == datavalues_uuid
        x = Base.require(pkg)

        eval(
            quote
            function JSON_print_escaped(io, val::$(x.DataValue))
                $(x.isna)(val) ? print(io, "null") : JSON_print_escaped(io, val[])
            end

            julia_type_to_schema_type(::Type{T}) where {S,T <: $(x.DataValue){S}} = julia_type_to_schema_type(S)
        end
        )
    end
end

function repl_showingrid_notification(conn, params::NamedTuple{(:code,),Tuple{String}})
    try
        var = Base.invokelatest(Base.include_string, Main, params.code)

        Base.invokelatest(internal_vscodedisplay, var)
    catch err
        Base.display_error(err, catch_backtrace())
    end
end

function internal_vscodedisplay(x)
    if showable("application/vnd.dataresource+json", x)
        _display(InlineDisplay(), x)
    elseif _isiterabletable(x) === true
        buffer = IOBuffer()
        io = IOContext(buffer, :compact => true)
        printdataresource(io, _getiterator(x))
        buffer_asstring = CachedDataResourceString(String(take!(buffer)))
        _display(InlineDisplay(), buffer_asstring)
    elseif _isiterabletable(x) === missing
        try
            buffer = IOBuffer()
            io = IOContext(buffer, :compact => true)
            printdataresource(io, _getiterator(x))
            buffer_asstring = CachedDataResourceString(String(take!(buffer)))
            _display(InlineDisplay(), buffer_asstring)
        catch err
            _display(InlineDisplay(), x)
        end
    elseif x isa AbstractVector || x isa AbstractMatrix
        buffer = IOBuffer()
        io = IOContext(buffer, :compact => true)
        print_array_as_dataresource(io, _getiterator(x))
        buffer_asstring = CachedDataResourceString(String(take!(buffer)))
        _display(InlineDisplay(), buffer_asstring)
    else
        _display(InlineDisplay(), x)
    end
end

vscodedisplay(x) = internal_vscodedisplay(x)
vscodedisplay() = i -> vscodedisplay(i)
