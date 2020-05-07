if VERSION < v"1.0.0"
    error("VS Code julia language server only works with julia 1.0.0+")
end

@info "Starting the Julia Language Server"

using InteractiveUtils, Sockets

include("error_handler.jl")

struct LSPrecompileFailure <: Exception
    msg::AbstractString
end

function Base.showerror(io::IO, ex::LSPrecompileFailure)
    print(io, ex.msg)
end

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

    symserver_store_path = joinpath(ARGS[5], "symbolstorev1")

    if !ispath(symserver_store_path)
        mkpath(symserver_store_path)
    end

    @info "Symbol server store is at '$symserver_store_path'."

    server = LanguageServerInstance(stdin, conn, Base.ARGS[1], Base.ARGS[4], global_err_handler, symserver_store_path)
    run(server)
catch e
    global_err_handler(e, catch_backtrace())
end
