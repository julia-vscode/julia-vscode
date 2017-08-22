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
    main_mode.prompt = string(newmodule,">")
    main_mode.on_done = Base.REPL.respond(repl,main_mode; pass_empty = false) do line
        if !isempty(line)
            :( eval($expr, parse($line)) )
        else
            :(  )
        end
    end
    println("Changed root module to $expr")
    print_with_color(:green, string(newmodule,">"), bold = true)
end

function get_available_modules(m=Main)
    out = Set{String}()
    for n in names(m, true, true)
        if isdefined(m, n) && getfield(m, n) isa Module && m != Symbol(m)
            push!(out, string(n))
        end
    end
    out
end

function generate_pipe_name(name)
    if is_windows()
        "\\\\.\\pipe\\vscode-language-julia-$name-$pid"
    elseif is_unix()
        joinpath(tempdir(), "vscode-language-julia-$name-$pid")
    end
end

!(is_unix() || is_windows()) && error("Unknown operating system.")

global_lock_socket_name = generate_pipe_name("terminal")
from_vscode = generate_pipe_name("torepl")
to_vscode = generate_pipe_name("fromrepl")

@async begin
    server = listen(from_vscode)
    while true
        sock = accept(server)
        msg = readline(sock)
        if startswith(msg, "repl/getAvailableModules")
            ms = get_available_modules(current_module())
            push!(ms, "Main")
            out = connect(to_vscode)
            write(out, string(join(ms, ","), "\n"))
            close(out)
        elseif startswith(msg, "repl/changeModule")
            change_module(strip(msg[20:end], '\n'))
        end
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
