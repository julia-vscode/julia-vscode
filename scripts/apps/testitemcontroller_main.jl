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

include(joinpath(@__DIR__, "..", "precompile_failures.jl"))

# Reported instead of the raw precompile error so that the extension's
# telemetry sink can recognise the report by name and show an actionable
# message rather than filing a crash; same convention as `LSPrecompileFailure`
# in `../languageserver/main.jl`.
struct TICPrecompileFailure <: Exception
    msg::AbstractString
end

function Base.showerror(io::IO, ex::TICPrecompileFailure)
    print(io, ex.msg)
end

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

    try
        using TestItemControllers
    catch err
        if is_precompile_failure(err)
            # The extension does not set JULIA_DEPOT_PATH when spawning this
            # process, so fall back to the effective depot path.
            depot_path = get(ENV, "JULIA_DEPOT_PATH", join(DEPOT_PATH, Sys.iswindows() ? ';' : ':'))
            println(stderr, """\n
            The test item controller failed to precompile.
            Please make sure you have permissions to write to the depot path at
            \t$(depot_path)
            """)
            throw(TICPrecompileFailure(sprint(showerror, err)))
        else
            rethrow(err)
        end
    end

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
