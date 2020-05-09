module VSCodeJuliaNotebook

import Sockets, Base64

const stdio_bytes = Ref(0)

const current_request_id = Ref(0)

const orig_stdin  = Ref{IO}()
const orig_stdout = Ref{IO}()
const orig_stderr = Ref{IO}()

const read_stdout = Ref{Base.PipeEndpoint}()
const read_stderr = Ref{Base.PipeEndpoint}()

const capture_stdout = true
const capture_stderr = false

const conn = Sockets.connect(ARGS[1])

function send_msg_to_vscode(connection, cmd, payload)
    encoded_payload = Base64.base64encode(payload)
    println(connection, cmd, ":", encoded_payload)
end

try

include("stdio.jl")

orig_stdin[]  = Base.stdin
orig_stdout[] = Base.stdout
orig_stderr[] = Base.stderr

if capture_stdout
    read_stdout[], = Base.redirect_stdout()
    redirect_stdout(JuliaNotebookStdio(Base.stdout,"stdout"))
end
if capture_stderr
    read_stderr[], = redirect_stderr()
    redirect_stderr(JuliaNotebookStdio(Base.stderr,"stderr"))
end
redirect_stdin(JuliaNotebookStdio(Base.stdin,"stdin"))

struct JuliaNotebookInlineDisplay <: AbstractDisplay end

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/png")}, x)
    payload = Base64.stringmime(MIME("image/png"), x)
    send_msg_to_vscode(conn, "image/png", string(current_request_id[], ";", payload))
end
Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/png")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/svg+xml")}, x)
    payload = Base64.stringmime(MIME("image/svg+xml"), x)
    send_msg_to_vscode(conn, "image/svg+xml", string(current_request_id[], ";", payload))
end
Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/svg+xml")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v4+json")}, x)
    payload = Base64.stringmime(MIME("application/vnd.vegalite.v4+json"), x)
    send_msg_to_vscode(conn, "application/vnd.vegalite.v4+json", string(current_request_id[], ";", payload))
end
Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v4+json")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, x)
    if showable("application/vnd.vegalite.v4+json", x) && false
        display(d,"application/vnd.vegalite.v4+json", x)
    elseif showable("image/svg+xml", x) && false
        display(d,"image/svg+xml", x)
    elseif showable("image/png", x)
        display(d,"image/png", x)
    else
        throw(MethodError(display,(d,x)))
    end
end

Base.Multimedia.pushdisplay(JuliaNotebookInlineDisplay())

watch_stdio()

while true
    l = readline(conn)

    parts = split(l, ':')

    current_request_id[] = parse(Int, parts[1])

    decoded_msg = String(Base64.base64decode(parts[2]))

    try
        result = include_string(Main, decoded_msg, "FOO")

        if result!==nothing
            Base.display(result)
        end

        send_msg_to_vscode(conn, "status/finished", string(current_request_id[]))
    catch err
        Base.display_error(err, catch_backtrace())
        send_msg_to_vscode(conn, "status/errored", string(current_request_id[]))
    end

    flush_all()
end

catch err
    Base.display_error(orig_stderr[], err, catch_backtrace())
    readline()
end

end
