module _vscodeserver

function remlineinfo!(x)
    if isa(x, Expr)
        if x.head == :macrocall && x.args[2] != nothing
            id = findall(map(x -> (isa(x, Expr) && x.head == :line) || (isdefined(:LineNumberNode) && x isa LineNumberNode), x.args))
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

using REPL, Sockets, Base64
import Base: display, redisplay
global active_module = :Main

struct InlineDisplay <: AbstractDisplay end

pid = Base.ARGS[1]
Base.ENV["JULIA_EDITOR"] = Base.ARGS[2]

function change_module(newmodule::String, print_change = true)
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
    expr = Meta.parse(newmodule)
    active_module = expr
    repl = Base.active_repl
    main_mode = repl.interface.modes[1]
    main_mode.prompt = string(newmodule,"> ")
    main_mode.on_done = REPL.respond(repl,main_mode; pass_empty = false) do line
        if !isempty(line)
            ex = Meta.parse(line)
            if ex isa Expr && ex.head == :module
                ret = :( Base.eval($expr, Expr(:(=), :ans, Expr(:toplevel, Meta.parse($line)))) )    
            else
                ret = :( Core.eval($expr, Expr(:(=), :ans, Meta.parse($line))) )  
            end
        else
            ret = :(  )
        end
        out = connect(to_vscode)
        write(out, string("repl/variables,", getVariables(), "\n"))
        close(out)
        return ret
    end
    print(" \r ")
    print_change && println("Changed root module to $expr")
    printstyled(string(newmodule,"> "), bold = true, color = :green)
end

function get_available_modules(m=Main, out = Module[])
    for n in names(m, all = true, imported = true)
        if isdefined(m, n) && getfield(m, n) isa Module  && !(getfield(m, n) in out)
            M = getfield(m, n)
            push!(out, M)
            get_available_modules(M, out)
        end
    end
    out
end

function getVariables()
    M = @__MODULE__
    variables = []
    msg = ""
    for n in names(M)
        !isdefined(M, n) && continue
        x = getfield(M, n)
        t = typeof(x)
        msg = string(msg, ";", n, "::", t)
    end
    return msg
end

function generate_pipe_name(name)
    if Sys.iswindows()
        "\\\\.\\pipe\\vscode-language-julia-$name-$pid"
    elseif Sys.isunix()
        joinpath(tempdir(), "vscode-language-julia-$name-$pid")
    end
end

!(Sys.isunix() || Sys.iswindows()) && error("Unknown operating system.")

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
        if cmd == "repl/include"
            cmod = Core.eval(active_module)
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
    print(conn, "image/png", ":", endof(payload), ";")
    print(conn, payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("image/png")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("image/svg+xml")}, x)
    payload = stringmime(MIME("image/svg+xml"), x)
    print(conn, "image/svg+xml", ":", endof(payload), ";")
    print(conn, payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("image/svg+xml")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("text/html")}, x)
    payload = stringmime(MIME("text/html"), x)
    print(conn, "text/html", ":", endof(payload), ";")
    print(conn, payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("text/html")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("juliavscode/html")}, x)
    payload = stringmime(MIME("juliavscode/html"), x)
    print(conn, "juliavscode/html", ":", endof(payload), ";")
    print(conn, payload)
end

Base.Multimedia.istextmime(::MIME{Symbol("juliavscode/html")}) = true

displayable(d::InlineDisplay, ::MIME{Symbol("juliavscode/html")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v2+json")}, x)
    payload = stringmime(MIME("application/vnd.vegalite.v2+json"), x)
    print(conn, "application/vnd.vegalite.v2+json", ":", endof(payload), ";")
    print(conn, payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v2+json")}) = true

function display(d::InlineDisplay, x)
    if showable("application/vnd.vegalite.v2+json", x)
        display(d,"application/vnd.vegalite.v2+json", x)
    elseif showable("juliavscode/html", x)
        display(d,"juliavscode/html", x)
    # elseif showable("text/html", x)
    #     display(d,"text/html", x)
    elseif showable("image/svg+xml", x)
        display(d,"image/svg+xml", x)
    elseif showable("image/png", x)
        display(d,"image/png", x)
    else
        throw(MethodError(display,(d,x)))
    end
    
end

atreplinit(i->Base.Multimedia.pushdisplay(InlineDisplay()))
end

@eval using Revise
Revise.async_steal_repl_backend()
