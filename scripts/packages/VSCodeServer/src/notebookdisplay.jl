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

function Base.display(d::JuliaNotebookInlineDisplay, x)
    things_to_show = IJuliaCore.display_dict(x)

    JSONRPC.send_notification(conn_endpoint[], "notebook/display", Dict("items" => [Dict{String,Any}("mimetype" => k, "data" => v) for (k, v) in things_to_show]))
end
