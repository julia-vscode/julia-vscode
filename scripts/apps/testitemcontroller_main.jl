if VERSION < v"1.10.0"
    error("VS Code test item controller only works with Julia 1.10.0 or newer")
end

@info "Starting test item controller on Julia $VERSION"

import Pkg
version_specific_env_path = joinpath(@__DIR__, "..", "environments", "testitemcontroller", "v$(VERSION.major).$(VERSION.minor)")
if isdir(version_specific_env_path)
    Pkg.activate(version_specific_env_path)
else
    Pkg.activate(joinpath(@__DIR__, "..", "environments", "testitemcontroller", "fallback"))
end

using Logging
global_logger(ConsoleLogger(stderr))

using InteractiveUtils, Sockets

include("../error_handler.jl")

try
    if length(Base.ARGS) != 1
        error("Invalid number of arguments passed to Julia test item controller.")
    end


    global conn_in = stdin
    global conn_out = stdout
    redirect_stdout(stderr)
    redirect_stdin()

    using TestItemControllers

    controller = JSONRPCTestItemController(
        conn_in,
        conn_out,
        (err, bt) -> global_err_handler(err, bt, Base.ARGS[1], "Test Item Controller"),
        error_handler_file = normpath(joinpath(@__DIR__, "../error_handler.jl")),
        crash_reporting_pipename = Base.ARGS[1]
    )

    run(controller)
catch err
    global_err_handler(err, catch_backtrace(), Base.ARGS[1], "Test Item Controller")
end
