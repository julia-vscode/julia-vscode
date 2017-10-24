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
global active_module = :Main

immutable InlineDisplay <: Display end

pid = Base.ARGS[1]

function change_module(newmodule::String)
    global active_module
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
    active_module = expr
    repl = Base.active_repl
    main_mode = repl.interface.modes[1]
    main_mode.prompt = string(newmodule,"> ")
    main_mode.on_done = Base.REPL.respond(repl,main_mode; pass_empty = false) do line
        if !isempty(line)
            ex = parse(line)
            if ex isa Expr && ex.head == :module
                ret = :( eval($expr, Expr(:(=), :ans, Expr(:toplevel, parse($line)))) )    
            else
                ret = :( eval($expr, Expr(:(=), :ans, parse($line))) )    
            end
        else
            ret = :(  )
        end
        out = connect(to_vscode)
        write(out, string("repl/variables,", getVariables(), "\n"))
        close(out)
        return ret
    end
    println("Changed root module to $expr")
    print_with_color(:green, string(newmodule,">"), bold = true)
end

function get_available_modules(m=Main, out = Module[])
    info("here")
    for n in names(m, true, true)
        if isdefined(m, n) && getfield(m, n) isa Module  && !(getfield(m, n) in out)
            M = getfield(m, n)
            push!(out, M)
            get_available_modules(M, out)
        end
    end
    out
end

function getVariables()
    M = current_module()
    variables = []
    msg = ""
    for n in names(M)
        !isdefined(M, n) && continue
        x = getfield(M, n)
        t = typeof(x)
        msg = string(msg, ",", n, "::", t)
    end
    return msg
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

if issocket(from_vscode)
    rm(from_vscode)
end

@async begin
    server = listen(from_vscode)
    while true
        sock = accept(server)
        cmd = readline(sock)
        !startswith(cmd, "repl/") && continue
        text = readuntil(sock, "repl/endMessage")[1:end-15]
        if cmd == "repl/getAvailableModules"
            oSTDERR = STDERR
            redirect_stderr()
            ms = get_available_modules(current_module())
            redirect_stderr(oSTDERR)
            names = unique(sort(string.(ms)))
            out = connect(to_vscode)
            write(out, string("repl/returnModules,", join(names, ","), "\n"))
            close(out)
        elseif cmd == "repl/changeModule"
            change_module(strip(text, '\n'))
        elseif cmd == "repl/include"
            cmod = eval(active_module)
            ex = Expr(:call, :include, strip(text, '\n'))
            cmod.eval(ex)
        elseif cmd == "repl/getVariables"
            out = connect(to_vscode)
            write(out, getVariables())
            close(out)
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
@async while true
    if isdefined(Base, :active_repl)
        change_module("Main")
        break
    end
end
end
