struct JuliaNotebookInlineDisplay <: AbstractDisplay end

# supported MIME types for inline display, in descending order
# of preference (descending "richness")
const supported_mime_types = [
    "application/vnd.dataresource+json",
    ["application/vnd.vegalite.v$n+json" for n = 4:-1:1]...,
    ["application/vnd.vega.v$n+json" for n = 5:-1:2]...,
    "application/vnd.plotly.v1+json",
    "text/html",
    "text/latex",
    "image/svg+xml",
    "image/png",
    "image/jpeg",
    "text/plain",
    "text/markdown",
    # "application/javascript"
]

for mime in supported_mime_types
    @eval begin
        function display(::JuliaNotebookInlineDisplay, ::MIME{Symbol($mime)}, x)
            IJuliaCore.flush_all() # so that previous stream output appears in order
            payload = IJuliaCore.limitstringmime(MIME($mime), x)
            JSONRPC.send_notification(conn_endpoint[], "notebook/display", Dict("items" => [Dict{String,Any}("mimetype" => $mime, "data" => payload)]))
        end
        displayable(d::InlineDisplay, ::MIME{Symbol($mime)}) = true
    end
end

function Base.display(::JuliaNotebookInlineDisplay, x)
    things_to_show = IJuliaCore.display_dict(x)

    JSONRPC.send_notification(conn_endpoint[], "notebook/display", Dict("items" => reverse([Dict{String,Any}("mimetype" => k, "data" => v) for (k, v) in things_to_show])))
end
