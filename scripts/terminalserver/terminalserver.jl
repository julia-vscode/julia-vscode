# this script basially only handles `ARGS`

ENV["JULIA_REVISE"] = "manual"

pushfirst!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
using VSCodeServer
popfirst!(LOAD_PATH)

let
    args = [popfirst!(Base.ARGS) for _ in 1:5]

    VSCodeServer.g_use_revise[] = "USE_REVISE=true" in args

    atreplinit() do repl
        VSCodeServer.toggle_plot_pane(nothing, (;enable="USE_PLOTPANE=true" in args))
        VSCodeServer.toggle_progress(nothing, (;enable="USE_PROGRESS=true" in args))
    end

    conn_pipeline, telemetry_pipeline = args[1:2]
    VSCodeServer.serve(conn_pipeline; is_dev="DEBUG_MODE=true" in args, crashreporting_pipename=telemetry_pipeline)
end
