module VSCodeNotebookServer

import Sockets, Base64, UUIDs

include("../../JSON/src/JSON.jl")

module JSONRPC
    import ..JSON
    import ..UUIDs

    include("../../JSONRPC/src/core.jl")
end

include("stdio.jl")

const stdio_bytes = Ref(0)

const current_request_id = Ref(0)

const orig_stdin  = Ref{IO}()
const orig_stdout = Ref{IO}()
const orig_stderr = Ref{IO}()

const read_stdout = Ref{Base.PipeEndpoint}()
const read_stderr = Ref{Base.PipeEndpoint}()

const capture_stdout = true
const capture_stderr = false

const conn_endpoint = Ref{Union{Nothing,JSONRPC.JSONRPCEndpoint}}(nothing)

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

function serve(pipename)
    conn = Sockets.connect(pipename)

    conn_endpoint[] = JSONRPC.JSONRPCEndpoint(conn, conn)

    run(conn_endpoint[])

    try
        orig_stdin[]  = Base.stdin
        orig_stdout[] = Base.stdout
        orig_stderr[] = Base.stderr

        if capture_stdout
            read_stdout[], = Base.redirect_stdout()
            redirect_stdout(JuliaNotebookStdio(Base.stdout, "stdout"))
        end
        if capture_stderr
            read_stderr[], = redirect_stderr()
            redirect_stderr(JuliaNotebookStdio(Base.stderr, "stderr"))
        end
        redirect_stdin(JuliaNotebookStdio(Base.stdin, "stdin"))

        Base.Multimedia.pushdisplay(JuliaNotebookInlineDisplay())

        watch_stdio()

        while true
            msg = JSONRPC.get_next_message(conn_endpoint[])

            if msg["method"] == "runcell"
                params = msg["params"]

                current_request_id[] = params["current_request_id"]
                decoded_msg = params["code"]

                try
                    result = Base.invokelatest(include_string, Main, decoded_msg, "FOO")

                    if result !== nothing
                        Base.display(result)
                    end

                    JSONRPC.send_success_response(conn_endpoint[], msg, "success")
                catch err
                    Base.display_error(err, catch_backtrace())
                    JSONRPC.send_success_response(conn_endpoint[], msg, "error")
                end

                flush_all()
            else
                error("Unknown message")
            end
        end

    catch err
        Base.display_error(orig_stderr[], err, catch_backtrace())
        readline()
    end

end

end
