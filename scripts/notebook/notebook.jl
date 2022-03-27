Base.push!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
using VSCodeServer
pop!(LOAD_PATH)

using InteractiveUtils

let
    args = [popfirst!(Base.ARGS) for _ in 1:2]

    conn_pipeline, telemetry_pipeline = args[1:2]

    ccall(:jl_exit_on_sigint, Nothing, (Cint,), false)

    outputchannel_logger = Base.CoreLogging.SimpleLogger(Base.stderr)

    VSCodeServer.serve_notebook(conn_pipeline, outputchannel_logger, crashreporting_pipename=telemetry_pipeline)
end
