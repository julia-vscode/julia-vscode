# this script basially only handles `ARGS`
let distributed = Base.PkgId(Base.UUID("8ba89e20-285c-5b6f-9357-94700520ee1b"), "Distributed")
    if haskey(Base.loaded_modules, distributed) && (Distributed = Base.loaded_modules[distributed]).nprocs() > 1
        Distributed.remotecall_eval(Main, 1:Distributed.nprocs(), :(pushfirst!(LOAD_PATH, joinpath($(@__DIR__), "..", "packages"))))
        using VSCodeServer
        Distributed.remotecall_eval(Main, 1:Distributed.nprocs(), :(popfirst!(LOAD_PATH)))
    else
        pushfirst!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
        using VSCodeServer
        popfirst!(LOAD_PATH)
    end
end

let
    args = [popfirst!(Base.ARGS) for _ in 1:7]
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

    if "ENABLE_SHELL_INTEGRATION=true" in args && !Sys.iswindows()
        VSCodeServer.ENABLE_SHELL_INTEGRATION[] = true
    end

    atreplinit() do repl
        VSCodeServer.toggle_plot_pane(nothing, (;enable="USE_PLOTPANE=true" in args))
        VSCodeServer.toggle_progress(nothing, (;enable="USE_PROGRESS=true" in args))
    end

    conn_pipeline, telemetry_pipeline = args[1:2]
    VSCodeServer.serve(conn_pipeline; is_dev="DEBUG_MODE=true" in args, crashreporting_pipename=telemetry_pipeline)
end
