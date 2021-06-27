# Lots of code here is copied from IJulia
# TODO figure out some way that we can share code with IJulia and don't do copy-paste

israwtext(::MIME, x::AbstractString) = true
israwtext(::MIME"text/plain", x::AbstractString) = false
israwtext(::MIME, x) = false

InlineIOContext(io, KVs::Pair...) = IOContext(
    io,
    :limit => true, :color => true, :jupyter => true,
    KVs...
)

function limitstringmime(mime::MIME, x)
    buf = IOBuffer()
    if istextmime(mime)
        if israwtext(mime, x)
            return String(x)
        else
            show(InlineIOContext(buf), mime, x)
        end
    else
        b64 = Base64EncodePipe(buf)
        if isa(x, Vector{UInt8})
            write(b64, x) # x assumed to be raw binary data
        else
            show(InlineIOContext(b64), mime, x)
        end
        close(b64)
    end
    return String(take!(buf))
end

_showable(a::AbstractVector{<:MIME}, x) = any(m -> showable(m, x), a)
_showable(m, x) = showable(m, x)

const ijulia_mime_types = Vector{Union{MIME,AbstractVector{MIME}}}([
    MIME("text/plain"),
    MIME("image/svg+xml"),
    [MIME("image/png"),MIME("image/jpeg")],
    [
        MIME("text/markdown"),
        MIME("text/html"),
    ],
    MIME("text/latex"),
])

const ijulia_jsonmime_types = Vector{Union{MIME,Vector{MIME}}}([
    [[MIME("application/vnd.vegalite.v$n+json") for n in 4:-1:2]...,
    [MIME("application/vnd.vega.v$n+json") for n in 5:-1:3]...],
    MIME("application/vnd.dataresource+json"), MIME("application/vnd.plotly.v1+json")
])

function display_mimestring(mime_array::Vector{MIME}, x)
    for m in mime_array
        if _showable(m, x)
            return display_mimestring(m, x)
        end
    end
    error("No displayable MIME types in mime array.")
end

display_mimestring(m::MIME, x) = (m, limitstringmime(m, x))

# text/plain output must have valid Unicode data to display in Jupyter
function display_mimestring(m::MIME"text/plain", x)
    s = limitstringmime(m, x)
    return m, (isvalid(s) ? s : "(binary data)")
end

"""
Generate the preferred json-MIME representation of x.
Returns a tuple with the selected MIME type and the representation of the data
using that MIME type (as a `JSONText`).
"""
function display_mimejson(mime_array::Vector{MIME}, x)
    for m in mime_array
        if _showable(m, x)
            return display_mimejson(m, x)
        end
    end
    error("No displayable MIME types in mime array.")
end

display_mimejson(m::MIME, x) = (m, JSON.JSONText(limitstringmime(m, x)))


struct JuliaNotebookInlineDisplay <: AbstractDisplay end

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/png")}, x)
    payload = Base.invokelatest(Base64.stringmime, MIME("image/png"), x)
    JSONRPC.send_notification(conn_endpoint[], "notebook/display", Dict("items" => [Dict{String,Any}("mimetype" => "image/png", "data" => payload)]))
end

Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/png")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/jpeg")}, x)
    payload = Base.invokelatest(Base64.stringmime, MIME("image/jpeg"), x)
    JSONRPC.send_notification(conn_endpoint[], "notebook/display", Dict("items" => [Dict{String,Any}("mimetype" => "image/jpeg", "data" => payload)]))
end

Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/jpeg")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/svg+xml")}, x)
    payload = Base.invokelatest(Base64.stringmime, MIME("image/svg+xml"), x)
    JSONRPC.send_notification(conn_endpoint[], "notebook/display", Dict("items" => [Dict{String,Any}("mimetype" => "image/svg+xml", "data" => payload)]))
end

Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/svg+xml")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v4+json")}, x)
    payload = Base.invokelatest(Base64.stringmime, MIME("application/vnd.vegalite.v4+json"), x)
    JSONRPC.send_notification(conn_endpoint[], "notebook/display", Dict("items" => [Dict{String,Any}("mimetype" => "application/vnd.vegalite.v4+json", "data" => payload)]))
end

Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v4+json")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("text/html")}, x)
    payload = Base.invokelatest(Base64.stringmime, MIME("text/html"), x)
    JSONRPC.send_notification(conn_endpoint[], "notebook/display", Dict("items" => [Dict{String,Any}("mimetype" => "text/html", "data" => payload)]))
end

Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("text/html")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("text/plain")}, x)
    payload = Base.invokelatest(Base64.stringmime, MIME("text/plain"), x)
    JSONRPC.send_notification(conn_endpoint[], "notebook/display", Dict("items" => [Dict{String,Any}("mimetype" => "text/plain", "data" => payload)]))
end

Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("text/plain")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("text/markdown")}, x)
    payload = Base.invokelatest(Base64.stringmime, MIME("text/markdown"), x)
    JSONRPC.send_notification(conn_endpoint[], "notebook/display", Dict("items" => [Dict{String,Any}("mimetype" => "text/markdown", "data" => payload)]))
end

Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("text/markdown")}) = true

"""
Generate a dictionary of `mime_type => data` pairs for all registered MIME
types. This is the format that Jupyter expects in display_data and
execute_result messages.
"""
function display_dict(x)
    data = Dict{String,Union{String,JSON.JSONText}}()
    for m in ijulia_mime_types
        try
            if _showable(m, x)
                mime, mime_repr = display_mimestring(m, x)
                data[string(mime)] = mime_repr
            end
        catch
            if m == MIME("text/plain")
                rethrow() # text/plain is required
            end
        end
    end

    for m in ijulia_jsonmime_types
        try
            if _showable(m, x)
                mime, mime_repr = display_mimejson(m, x)
                data[string(mime)] = mime_repr
            end
        catch
        end
end

    return data

end

function Base.display(d::JuliaNotebookInlineDisplay, x)
    things_to_show = display_dict(x)

    JSONRPC.send_notification(conn_endpoint[], "notebook/display", Dict("items" => [Dict{String,Any}("mimetype" => k, "data" => v) for (k, v) in things_to_show]))
end
