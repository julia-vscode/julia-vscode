if VERSION < v"1.0.0"
    error("VS Code julia language server only works with julia 1.0.0+")
end

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
    if length(Base.ARGS) != 7
        error("Invalid number of arguments passed to julia language server.")
    end

    debug_mode = if Base.ARGS[2] == "--debug=yes"
        true
    elseif Base.ARGS[2] == "--debug=no"
        false
    else
        error("Invalid argument passed.")
    end

    detached_mode = if Base.ARGS[7] == "--detached=yes"
        true
    elseif Base.ARGS[7] == "--detached=no"
        false
    else
        error("Invalid argumentpassed.")
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
            throw(LSPrecompileFailure(err.msg))
        else
            rethrow(err)
        end
    end

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
        ARGS[6] == "download"
    )
    run(server)
catch err
    global_err_handler(err, catch_backtrace(), Base.ARGS[3], "Language Server")
end
