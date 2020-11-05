# this script basially only handles `ARGS`

pushfirst!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
using VSCodeServer
popfirst!(LOAD_PATH)

let
    args = [popfirst!(Base.ARGS) for _ in 1:5]
    # load Revise ?
    if "USE_REVISE=true" in args
        try
            @static if VERSION ≥ v"1.5"
                using Revise
            else
                @eval using Revise
                Revise.async_steal_repl_backend()
            end
        catch err
        end
    end

    atreplinit() do repl
        VSCodeServer.toggle_plot_pane(nothing, "USE_PLOTPANE=true" in args)
    end

    conn_pipeline, telemetry_pipeline = args[1:2]
    VSCodeServer.serve(conn_pipeline; is_dev="DEBUG_MODE=true" in args, crashreporting_pipename=telemetry_pipeline)
end
