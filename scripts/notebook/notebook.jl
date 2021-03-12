Base.push!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
using VSCodeServer
pop!(LOAD_PATH)

let
    args = [popfirst!(Base.ARGS) for _ in 1:2]

    conn_pipeline, telemetry_pipeline = args[1:2]

    VSCodeServer.serve_notebook(conn_pipeline, crashreporting_pipename=telemetry_pipeline)
end
