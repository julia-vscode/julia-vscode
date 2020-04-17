if VERSION < v"1.0.0"
    error("VS Code julia language server only works with julia 1.0.0+")
end

@info "Starting the Julia Language Server"

using InteractiveUtils

include("../error_handler.jl")

try
    if length(Base.ARGS) != 4
        error("Invalid number of arguments passed to julia language server.")
    end

    conn = stdout
    (outRead, outWrite) = redirect_stdout()

    if Base.ARGS[2] == "--debug=no"
        const global ls_debug_mode = false
    elseif Base.ARGS[2] == "--debug=yes"
        const global ls_debug_mode = true
    end

    using LanguageServer, Sockets, SymbolServer

    server = LanguageServerInstance(
        stdin,
        conn,
        ls_debug_mode,
        Base.ARGS[1],
        Base.ARGS[4],
        (err, bt)-> global_err_handler(err, bt, Base.ARGS[3])
    )
    run(server)
catch err
    global_err_handler(err, catch_backtrace(), Base.ARGS[3])
end
