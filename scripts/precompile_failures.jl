# Decides whether an error thrown while loading one of the extension's Julia
# apps (`using LanguageServer`, `using TestItemControllers`) means the app
# could not be precompiled or loaded on this machine: a package that failed to
# precompile, a broken depot, a cache file that cannot be opened, or a Julia
# installation that cannot spawn its own precompilation workers. These are
# conditions of the user's machine, not bugs, so the launchers turn them into
# an actionable message instead of a crash report.
function is_precompile_failure(err)
    if err isa ErrorException
        # "Error opening package file ..." comes from
        # `jl_restore_package_image_from_file`, which could not load a cache
        # file that is there: an application control policy or an antivirus
        # blocked it, it is corrupt, or the filesystem it sits on will not map
        # it. Julia reports that instead of falling back to recompiling, and
        # every one of those causes is the machine rather than this app.
        return startswith(err.msg, "Failed to precompile") ||
            occursin("failed to precompile", lowercase(err.msg)) ||
            startswith(err.msg, "Error opening package file")
    elseif err isa LoadError
        return is_precompile_failure(err.error)
    elseif err isa Base.SystemError
        # A failed file operation on the compiled cache (e.g. "opening file
        # '~/.julia/compiled/v1.x/JuliaWorkspaces/xyz.ji': Permission denied")
        # is a broken depot, not an app bug: the depot-permissions message
        # the caller shows is the actionable response, not a crash report.
        return occursin("compiled", err.prefix) || occursin(".ji", err.prefix)
    elseif err isa Base.IOError
        # During loading, the only processes Julia spawns are its own
        # precompilation workers, using the very binary that is running. A
        # spawn failure means the installation is broken or gone, e.g. an
        # environment manager replaced it mid-session.
        return startswith(err.msg, "could not spawn")
    elseif occursin("PkgPrecompileError", string(typeof(err)))
        return true
    else
        return occursin("failed to precompile", lowercase(sprint(showerror, err)))
    end
end
