if VERSION < v"1.0.0"
    error("VS Code julia language server only works with julia 1.0.0+")
end

@info "Starting the Julia Language Server"

using InteractiveUtils, Sockets

function memlog(timer)
    get(ENV, "JULIA_DEBUG", "") == "ALL" || return
    logdir = joinpath(dirname(dirname(@__DIR__)), "logs")
    isdir(logdir) || mkdir(logdir)
    open(joinpath(logdir, "Main_varinfo.log"), "w") do io
        show(io, InteractiveUtils.varinfo(Main, all=true, sortby=:size, imported=true))
    end
    open(joinpath(logdir, "LanguageServer_varinfo.log"), "w") do io
        show(io, InteractiveUtils.varinfo(LanguageServer, all=true, sortby=:size, imported=true))
    end
    open(joinpath(logdir, "SymbolServer_varinfo.log"), "w") do io
        show(io, InteractiveUtils.varinfo(SymbolServer, all=true, sortby=:size, imported=true))
    end
end

include("../error_handler.jl")

struct LSPrecompileFailure <: Exception
    msg::AbstractString
end

function Base.showerror(io::IO, ex::LSPrecompileFailure)
    print(io, ex.msg)
end

server = nothing # in the global scope so that memory allocation can be probed

try
    if length(Base.ARGS) != 5
        error("Invalid number of arguments passed to julia language server.")
    end

    conn = stdout
    (outRead, outWrite) = redirect_stdout()

    if Base.ARGS[2] == "--debug=yes"
        ENV["JULIA_DEBUG"] = "all"
    elseif Base.ARGS[2] != "--debug=no"
        error("Invalid argument passed.")
    end

    try
        using LanguageServer, SymbolServer
    catch err
        if err isa ErrorException && startswith(err.msg, "Failed to precompile")
            throw(LSPrecompileFailure(err.msg))
        else
            rethrow(err)
        end
    end

    symserver_store_path = joinpath(ARGS[5], "symbolstorev4")

    if !ispath(symserver_store_path)
        mkpath(symserver_store_path)
    end

    @info "Symbol server store is at '$symserver_store_path'."

    server = LanguageServerInstance(
        stdin,
        conn,
        Base.ARGS[1],
        Base.ARGS[4],
        (err, bt)->global_err_handler(err, bt, Base.ARGS[3], "Language Server"),
        symserver_store_path
    )
    Timer(memlog, 0, interval = 30)
    run(server)
catch err
    global_err_handler(err, catch_backtrace(), Base.ARGS[3], "Language Server")
end
