@static if VERSION < v"1.8.0"
    import Pkg
end

# this script basially only handles `ARGS`
let distributed = Base.PkgId(Base.UUID("8ba89e20-285c-5b6f-9357-94700520ee1b"), "Distributed")
    include("../error_handler.jl")

    version_specific_env_path = joinpath(@__DIR__, "..", "environments", "terminalserver", "v$(VERSION.major).$(VERSION.minor)")
    if !isdir(version_specific_env_path)
        version_specific_env_path = joinpath(@__DIR__, "..", "environments", "terminalserver", "fallback")
    end

    @static if VERSION < v"1.8.0"
        Pkg.activate(version_specific_env_path)
    else
        Base.set_active_project(joinpath(version_specific_env_path,"Project.toml"))
    end


    args = [popfirst!(Base.ARGS) for _ in 1:9]
    conn_pipename, debug_pipename, telemetry_pipename, project_path = args[1:4]

    if haskey(Base.loaded_modules, distributed) && (Distributed = Base.loaded_modules[distributed]).nprocs() > 1
        Distributed.remotecall_eval(Main, 1:Distributed.nprocs(), :(pushfirst!(LOAD_PATH, joinpath($(@__DIR__), "..", "packages"))))
        try
            using VSCodeServer
        finally
            Distributed.remotecall_eval(Main, 1:Distributed.nprocs(), :(popfirst!(LOAD_PATH)))
        end
    else
        pushfirst!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
        try
            using VSCodeServer
        finally
            popfirst!(LOAD_PATH)
        end
    end

    @static if VERSION < v"1.8.0"
        # TODO Maybe surpress output if all goes well
        Pkg.activate(project_path)
    else
        Base.set_active_project(joinpath(project_path,"Project.toml"))
    end

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

    VSCodeServer.serve(conn_pipename, debug_pipename; is_dev="DEBUG_MODE=true" in args, error_handler = (err, bt) -> global_err_handler(err, bt, telemetry_pipename, "REPL"))
end
