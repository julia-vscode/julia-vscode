module _vscodeserver

import Base: display, redisplay

immutable InlineDisplay <: Display end

pid = Base.ARGS[1]

function change_module(newmodule::String)
    smods = Symbol.(split(newmodule, "."))

    val = Main
    for i = 1:length(smods)
        if isdefined(val, smods[i])
            val = getfield(val, smods[i])
        else
            println("Could not find module $newmodule")
            return
        end
    end
    expr = parse(newmodule)
    repl = Base.active_repl
    main_mode = repl.interface.modes[1]
    main_mode.on_done = Base.REPL.respond(repl,main_mode; pass_empty = false) do line
        if !isempty(line)
            :( eval($expr, parse($line)) )
        else
            :(  )
        end
    end
    println("Changed root module to $expr")
    print_with_color(:green, "julia> ", bold = true)
end

if is_windows()
    global_lock_socket_name = "\\\\.\\pipe\\vscode-language-julia-terminal-$pid"
    modchange_sock_name = "\\\\.\\pipe\\vscode-language-julia-modchange-$pid"
elseif is_unix() 
    global_lock_socket_name = joinpath(tempdir(), "vscode-language-julia-terminal-$pid")
    modchange_sock_name = joinpath(tempdir(), "vscode-language-julia-modchange-$pid")
else
    error("Unknown operating system.")
end

@async begin
        server = listen(modchange_sock_name)
        while true
            sock = accept(server)
            msg = readline(sock)
            change_module(strip(msg, '\n'))
        end
    end

conn = connect(global_lock_socket_name)

function display(d::InlineDisplay, ::MIME{Symbol("image/png")}, x)
    payload = stringmime(MIME("image/png"), x)
    print(conn, "image/png", ":", length(payload), ";")
    print(conn, payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("image/png")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("image/svg+xml")}, x)
    payload = stringmime(MIME("image/svg+xml"), x)
    print(conn, "image/svg+xml", ":", length(payload), ";")
    print(conn, payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("image/svg+xml")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("text/html")}, x)
    payload = stringmime(MIME("text/html"), x)
    print(conn, "text/html", ":", length(payload), ";")
    print(conn, payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("text/html")}) = true

function display(d::InlineDisplay, x)
    # if mimewritable("text/html", x)
    #     display(d,"text/html", x)
    if mimewritable("image/svg+xml", x)
        display(d,"image/svg+xml", x)
    elseif mimewritable("image/png", x)
        display(d,"image/png", x)
    else
        throw(MethodError(display,(d,x)))
    end
    
end

atreplinit(i->Base.Multimedia.pushdisplay(InlineDisplay()))

end
