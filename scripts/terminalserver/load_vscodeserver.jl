let distributed = Base.PkgId(Base.UUID("8ba89e20-285c-5b6f-9357-94700520ee1b"), "Distributed"),
    extra_package_global = Symbol("#vscode_extra_package")
    version_specific_env_path = joinpath(@__DIR__, "..", "environments", "terminalserver", "v$(VERSION.major).$(VERSION.minor)", "Project.toml")
    if !isfile(version_specific_env_path)
        version_specific_env_path = joinpath(@__DIR__, "..", "environments", "terminalserver", "fallback", "Project.toml")
    end

    # The including script can name a package of this environment to load along with VSCodeServer,
    # in a global of `Main` whose leading `#` keeps it out of the workspace view.
    using_extra_package = isdefined(Main, extra_package_global) ?
        Expr(:using, Expr(:., getfield(Main, extra_package_global))) : nothing

    # No package is loaded yet, so every method called here that Julia has not compiled in
    # advance is compiled at every start. Hence direct calls, and expressions for the
    # Distributed workers, instead of closures, and `getfield` instead of dereferencing
    # `Base.ACTIVE_PROJECT`.
    prev_proj_path = getfield(Base.ACTIVE_PROJECT, :x)
    @static if VERSION < v"1.8.0"
        activate_env = :(Base.ACTIVE_PROJECT[] = $version_specific_env_path)
        deactivate_env = :(Base.ACTIVE_PROJECT[] = $prev_proj_path)
    else
        activate_env = :(Base.set_active_project($version_specific_env_path))
        deactivate_env = :(Base.set_active_project($prev_proj_path))
    end

    try
        @static if VERSION < v"1.8.0"
            Base.ACTIVE_PROJECT[] = version_specific_env_path
        else
            Base.set_active_project(version_specific_env_path)
        end
        if Base.root_module_exists(distributed) && (Distributed = Base.root_module(distributed)).nprocs() > 1
            Distributed.remotecall_eval(Main, 1:Distributed.nprocs(), activate_env)
            try
                using VSCodeServer
                using_extra_package === nothing || Core.eval(Main, using_extra_package)
            finally
                Distributed.remotecall_eval(Main, 1:Distributed.nprocs(), deactivate_env)
            end
        else
            using VSCodeServer
            using_extra_package === nothing || Core.eval(Main, using_extra_package)
        end
    finally
        @static if VERSION < v"1.8.0"
            Base.ACTIVE_PROJECT[] = prev_proj_path
        else
            Base.set_active_project(prev_proj_path)
        end
    end
end
