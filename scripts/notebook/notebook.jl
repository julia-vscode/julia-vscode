module VSCodeJuliaNotebook

import Sockets, Base64

function send_msg_to_vscode(connection, cmd, payload)
    println(connection, cmd, ":", payload)
end

const conn = Sockets.connect(ARGS[1])

const current_results = []

struct JuliaNotebookInlineDisplay <: AbstractDisplay end

function Base.display(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/png")}, x)
    payload = Base64.stringmime(MIME("image/png"), x)
    push!(current_results, "image/png" => payload)    
end

Base.displayable(d::JuliaNotebookInlineDisplay, ::MIME{Symbol("image/png")}) = true

function Base.display(d::JuliaNotebookInlineDisplay, x)
    if showable("image/png", x)
        display(d,"image/png", x)
    else
        throw(MethodError(display,(d,x)))
    end
end

Base.Multimedia.pushdisplay(JuliaNotebookInlineDisplay())

while true
    l = readline(conn)

    parts = split(l, ':')

    current_request_id = parse(Int, parts[1])

    decoded_msg = String(Base64.base64decode(parts[2]))

    try
        result = include_string(Main, decoded_msg, "FOO")

        if result!==nothing
            Base.display(result)
        end
    catch err
        Base.display_error(err, catch_backtrace())
    end

    for r in current_results
        send_msg_to_vscode(conn, r[1], string(current_request_id, ";", r[2]))
    end
    empty!(current_results)
end

end
