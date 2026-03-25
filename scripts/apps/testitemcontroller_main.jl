if VERSION < v"1.12.0"
    error("VS Code test item controller only works with Julia 1.12.0 or newer")
end

@info "Starting test item controller on Julia $VERSION"

import Pkg
version_specific_env_path = joinpath(@__DIR__, "..", "environments", "testitemcontroller", "v$(VERSION.major).$(VERSION.minor)")
if isdir(version_specific_env_path)
    Pkg.activate(version_specific_env_path)
else
    Pkg.activate(joinpath(@__DIR__, "..", "environments", "testitemcontroller", "fallback"))
end

using Logging, LoggingExtras, VSCodeErrorLoggers

if length(Base.ARGS) != 1
    error("Invalid number of arguments passed to Julia test item controller.")
end

global const crash_reporting_pipename = Base.ARGS[1]

global_logger(TeeLogger(
    ConsoleLogger(stderr),
    VSCodeErrorLogger(crash_reporting_pipename, "Test Item Controller", true)
))

try
    global conn_in = stdin
    global conn_out = stdout
    redirect_stdout(stderr)
    redirect_stdin()

    using TestItemControllers

    controller = JSONRPCTestItemController(
        conn_in,
        conn_out,
        error_handler_file = normpath(joinpath(@__DIR__, "../error_handler.jl")),
        crash_reporting_pipename = crash_reporting_pipename
    )

    run(controller)
catch err
    @error("Test item controller error", exception = (err, catch_backtrace()))
end
