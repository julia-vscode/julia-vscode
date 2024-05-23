if VERSION < v"1.6.0"
    error("VS Code julia language server only works with julia 1.6.0 or newer")
end

import Pkg
version_specific_env_path = joinpath(@__DIR__, "..", "environments", "languageserver", "v$(VERSION.major).$(VERSION.minor)")
if isdir(version_specific_env_path)
    Pkg.activate(version_specific_env_path)
else
    Pkg.activate(joinpath(@__DIR__, "..", "environments", "languageserver", "fallback"))
end

@debug "Julia started at $(round(Int, time()))"

using Logging
global_logger(ConsoleLogger(stderr))

@info "Starting the Julia Language Server"

using InteractiveUtils, Sockets

include("../error_handler.jl")

struct LSPrecompileFailure <: Exception
    msg::AbstractString
end

function Base.showerror(io::IO, ex::LSPrecompileFailure)
    print(io, ex.msg)
end

try
    if length(Base.ARGS) != 8
        error("Invalid number of arguments passed to julia language server.")
    end

    debug_mode = if Base.ARGS[2] == "--debug=yes"
        true
    elseif Base.ARGS[2] == "--debug=no"
        false
    else
        error("Invalid argument passed.")
    end

    detached_mode = if Base.ARGS[8] == "--detached=yes"
        true
    elseif Base.ARGS[8] == "--detached=no"
        false
    else
        error("Invalid argument passed.")
    end

    if debug_mode
        ENV["JULIA_DEBUG"] = "all"
    end

    if detached_mode
        serv = listen(7777)
        global conn_in = accept(serv)
        global conn_out = conn_in
    else
        global conn_in = stdin
        global conn_out = stdout
        (outRead, outWrite) = redirect_stdout()
    end


    try
        using LanguageServer, SymbolServer
    catch err
        if err isa ErrorException && startswith(err.msg, "Failed to precompile")
            println(stderr, """\n
            The Language Server failed to precompile.
            Please make sure you have permissions to write to the LS depot path at
            \t$(ENV["JULIA_DEPOT_PATH"])
            """)
            throw(LSPrecompileFailure(err.msg))
        else
            rethrow(err)
        end
    end

    @debug "LanguageServer.jl loaded at $(round(Int, time()))"

    symserver_store_path = joinpath(ARGS[5], "symbolstorev5")

    if !ispath(symserver_store_path)
        mkpath(symserver_store_path)
    end

    @info "Symbol server store is at '$symserver_store_path'."

    server = LanguageServerInstance(
        conn_in,
        conn_out,
        Base.ARGS[1],
        Base.ARGS[4],
        (err, bt) -> global_err_handler(err, bt, Base.ARGS[3], "Language Server"),
        symserver_store_path,
        ARGS[6] == "download",
        Base.ARGS[7]
    )
    @info "Starting LS at $(round(Int, time()))"
    run(server)
catch err
    global_err_handler(err, catch_backtrace(), Base.ARGS[3], "Language Server")
end
