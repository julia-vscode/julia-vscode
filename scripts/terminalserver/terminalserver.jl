# this script basially only handles `ARGS`

pushfirst!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
try
    using VSCodeServer
catch err
    local distributed = Base.PkgId(Base.UUID("8ba89e20-285c-5b6f-9357-94700520ee1b"), "Distributed")
    if haskey(Base.loaded_modules, distributed)
        local Distributed = Base.loaded_modules[distributed]
        if err isa CompositeException
            local ex1 = first(err.exceptions)
            if ex1 isa Distributed.RemoteException && ex1.pid == 1
                rethrow()
            end
        else
            rethrow()
        end
    else
        rethrow()
    end
end
popfirst!(LOAD_PATH)

let
    args = [popfirst!(Base.ARGS) for _ in 1:6]
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
        VSCodeServer.toggle_plot_pane(nothing, (;enable="USE_PLOTPANE=true" in args))
        VSCodeServer.toggle_progress(nothing, (;enable="USE_PROGRESS=true" in args))
    end

    conn_pipeline, telemetry_pipeline = args[1:2]
    VSCodeServer.serve(conn_pipeline; is_dev="DEBUG_MODE=true" in args, crashreporting_pipename=telemetry_pipeline)
end
