struct JuliaNotebookInlineDisplay <: AbstractDisplay end

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/png")}, x)
    payload = Base.invokelatest(Base64.stringmime, MIME("image/png"), x)
    JSONRPC.send_notification(conn_endpoint[], "display", Dict{String,Any}("mimetype" => "image/png", "current_request_id" => current_request_id[], "data" => payload))
end

Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/png")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/jpeg")}, x)
    payload = Base.invokelatest(Base64.stringmime, MIME("image/jpeg"), x)
    JSONRPC.send_notification(conn_endpoint[], "display", Dict{String,Any}("mimetype" => "image/jpeg", "current_request_id" => current_request_id[], "data" => payload))
end

Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/jpeg")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/svg+xml")}, x)
    payload = Base.invokelatest(Base64.stringmime, MIME("image/svg+xml"), x)
    JSONRPC.send_notification(conn_endpoint[], "display", Dict{String,Any}("mimetype" => "image/svg+xml", "current_request_id" => current_request_id[], "data" => payload))
end

Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/svg+xml")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v4+json")}, x)
    payload = Base.invokelatest(Base64.stringmime, MIME("application/vnd.vegalite.v4+json"), x)
    JSONRPC.send_notification(conn_endpoint[], "display", Dict{String,Any}("mimetype" => "application/vnd.vegalite.v4+json", "current_request_id" => current_request_id[], "data" => payload))
end

Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v4+json")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("text/html")}, x)
    payload = Base.invokelatest(Base64.stringmime, MIME("text/html"), x)
    JSONRPC.send_notification(conn_endpoint[], "display", Dict{String,Any}("mimetype" => "text/html", "current_request_id" => current_request_id[], "data" => payload))
end

Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("text/html")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("text/plain")}, x)
    payload = Base.invokelatest(Base64.stringmime, MIME("text/plain"), x)
    JSONRPC.send_notification(conn_endpoint[], "display", Dict{String,Any}("mimetype" => "text/plain", "current_request_id" => current_request_id[], "data" => payload))
end

Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("text/plain")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("text/markdown")}, x)
    payload = Base.invokelatest(Base64.stringmime, MIME("text/markdown"), x)
    JSONRPC.send_notification(conn_endpoint[], "display", Dict{String,Any}("mimetype" => "text/markdown", "current_request_id" => current_request_id[], "data" => payload))
end

Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("text/markdown")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, x)
    if showable("application/vnd.vegalite.v4+json", x) && false
        display(d, "application/vnd.vegalite.v4+json", x)
    elseif showable("image/svg+xml", x)
        display(d, "image/svg+xml", x)
    elseif showable("image/png", x)
        display(d, "image/png", x)
    elseif showable("image/jpeg", x)
        display(d, "image/jpeg", x)
    elseif showable("text/html", x)
        display(d, "text/html", x)
    elseif showable("text/markdown", x)
        display(d, "text/markdown", x)
    elseif showable("text/plain", x)
        display(d, "text/plain", x)
    else
        throw(MethodError(display, (d, x)))
    end
end
