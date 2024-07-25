# this script loads VSCodeServer and handles ARGS
let
    include("load_vscodeserver.jl")

    args = [popfirst!(Base.ARGS) for _ in 1:9]
    conn_pipename, debug_pipename, telemetry_pipename, project_path = args[1:4]

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
        VSCodeServer.toggle_plot_pane(nothing, (;enable="USE_PLOTPANE=true" in args))
        VSCodeServer.toggle_progress(nothing, (;enable="USE_PROGRESS=true" in args))
    end

    VSCodeServer.serve(conn_pipename, debug_pipename; is_dev="DEBUG_MODE=true" in args, error_handler = (err, bt) -> VSCodeServer.global_err_handler(err, bt, telemetry_pipename, "REPL"))
end
