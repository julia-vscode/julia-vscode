# this script loads VSCodeServer and handles ARGS
let
    args = [popfirst!(Base.ARGS) for _ in 1:8]
    conn_pipename, debug_pipename, telemetry_pipename = args[1:3]

    include("load_vscodeserver.jl")

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

    if !Sys.iswindows() && "ENABLE_SHELL_INTEGRATION=true" in args
        VSCodeServer.ENABLE_SHELL_INTEGRATION[] = true
    end

    atreplinit() do repl
        VSCodeServer.toggle_plot_pane_notification(nothing, (;enable="USE_PLOTPANE=true" in args))
        VSCodeServer.toggle_progress_notification(nothing, (;enable="USE_PROGRESS=true" in args))
    end

    VSCodeServer.serve(conn_pipename, debug_pipename; is_dev="DEBUG_MODE=true" in args, error_handler = (err, bt) -> VSCodeServer.global_err_handler(err, bt, telemetry_pipename, "REPL"))
end
