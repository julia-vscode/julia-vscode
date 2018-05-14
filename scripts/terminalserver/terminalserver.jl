module _vscodeserver

@static if VERSION < v"0.7.0-DEV.357"
    function remlineinfo!(x)
        if isa(x, Expr)
            id = find(map(x -> (isa(x, Expr) && x.head == :line) || (isdefined(:LineNumberNode) && x isa LineNumberNode), x.args))
            deleteat!(x.args, id)
            for j in x.args
                remlineinfo!(j)
            end
        end
        x
    end
else
    function remlineinfo!(x)
        if isa(x, Expr)
            if x.head == :macrocall && x.args[2] != nothing
                id = find(map(x -> (isa(x, Expr) && x.head == :line) || (isdefined(:LineNumberNode) && x isa LineNumberNode), x.args))
                deleteat!(x.args, id)
                for j in x.args
                    remlineinfo!(j)
                end
                insert!(x.args, 2, nothing)
            else
                id = find(map(x -> (isa(x, Expr) && x.head == :line) || (isdefined(:LineNumberNode) && x isa LineNumberNode), x.args))
                deleteat!(x.args, id)
                for j in x.args
                    remlineinfo!(j)
                end
            end
        end
        x
    end
end

import Base: display, redisplay

struct InlineDisplay <: Display end

pid = Base.ARGS[1]
Base.ENV["JULIA_EDITOR"] = Base.ARGS[2]

function generate_pipe_name(name)
    if is_windows()
        "\\\\.\\pipe\\vscode-language-julia-$name-$pid"
    elseif is_unix()
        joinpath(tempdir(), "vscode-language-julia-$name-$pid")
    end
end

!(is_unix() || is_windows()) && error("Unknown operating system.")

global_lock_socket_name = generate_pipe_name("newrepl")

conn = connect(global_lock_socket_name)

@async begin
    while true
        header = readline(conn)
        header_split = split(header, ':')
        payload_length = parse(Int, header_split[1])
        cmd = header_split[2]
        payload = read(conn, UInt8, payload_length)
        if cmd == "repl/executeCode"
            code_to_run = String(payload)
            eval(parse(code_to_run))
        # elseif cmd == "repl/getAvailableModules"
        #     oSTDERR = STDERR
        #     redirect_stderr()
        #     ms = get_available_modules(current_module())
        #     redirect_stderr(oSTDERR)
        #     names = unique(sort(string.(ms)))
        #     out = connect(to_vscode)
        #     write(out, string("repl/returnModules,", join(names, ","), "\n"))
        #     close(out)
        # elseif cmd == "repl/include"
        #     cmod = eval(active_module)
        #     ex = Expr(:call, :include, strip(text, '\n'))
        #     cmod.eval(ex)
        end
    end
end

function display(d::InlineDisplay, ::MIME{Symbol("image/png")}, x)
    payload = stringmime(MIME("image/png"), x)
    println(conn, endof(payload), ":", "image/png")
    print(conn, payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("image/png")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("image/svg+xml")}, x)
    payload = stringmime(MIME("image/svg+xml"), x)
    println(conn, endof(payload), ":", "image/svg+xml")
    print(conn, payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("image/svg+xml")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("text/html")}, x)
    payload = stringmime(MIME("text/html"), x)
    println(conn, endof(payload), ":", "text/html")
    print(conn, payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("text/html")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("juliavscode/html")}, x)
    payload = stringmime(MIME("juliavscode/html"), x)
    println(conn, endof(payload), ":", "juliavscode/html")
    print(conn, payload)
end

Base.Multimedia.istextmime(::MIME{Symbol("juliavscode/html")}) = true

displayable(d::InlineDisplay, ::MIME{Symbol("juliavscode/html")}) = true

function display(d::InlineDisplay, x)
    if mimewritable("juliavscode/html", x)
        display(d,"juliavscode/html", x)
    # elseif mimewritable("text/html", x)
    #     display(d,"text/html", x)
    elseif mimewritable("image/svg+xml", x)
        display(d,"image/svg+xml", x)
    elseif mimewritable("image/png", x)
        display(d,"image/png", x)
    else
        throw(MethodError(display,(d,x)))
    end
    
end

atreplinit(i->Base.Multimedia.pushdisplay(InlineDisplay()))

end
