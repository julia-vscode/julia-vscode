let distributed = Base.PkgId(Base.UUID("8ba89e20-285c-5b6f-9357-94700520ee1b"), "Distributed")
    version_specific_env_path = joinpath(@__DIR__, "..", "environments", "terminalserver", "v$(VERSION.major).$(VERSION.minor)", "Project.toml")
    if !isfile(version_specific_env_path)
        version_specific_env_path = joinpath(@__DIR__, "..", "environments", "terminalserver", "fallback", "Project.toml")
    end

    prev_proj_path = Base.ACTIVE_PROJECT[]

    activate_env = () -> begin
        @static if VERSION < v"1.8.0"
            Base.ACTIVE_PROJECT[] = version_specific_env_path
        else
            Base.set_active_project(version_specific_env_path)
        end
    end
    deactivate_env = () -> begin
        @static if VERSION < v"1.8.0"
            Base.ACTIVE_PROJECT[] = prev_proj_path
        else
            Base.set_active_project(prev_proj_path)
        end
    end

    activate_env()

    if haskey(Base.loaded_modules, distributed) && (Distributed = Base.loaded_modules[distributed]).nprocs() > 1
        Distributed.remotecall_eval(Main, 1:Distributed.nprocs(), :($(activate_env)()))
        try
            using VSCodeServer
        finally
            Distributed.remotecall_eval(Main, 1:Distributed.nprocs(), :($(deactivate_env)()))
        end
    else
        using VSCodeServer
    end

    deactivate_env()
end
