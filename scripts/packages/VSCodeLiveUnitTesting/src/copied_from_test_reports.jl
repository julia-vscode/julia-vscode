# All code in this file was copied from https://github.com/JuliaTesting/TestReports.jl/blob/cc146819be746274c286e544ff3ab540bd1226e6/src/runner.jl

using Pkg
import Pkg: PackageSpec, Types
import Pkg.Types: Context, EnvCache, ensure_resolved, is_project_uuid
import Pkg.Operations: project_resolve!, project_deps_resolve!, manifest_resolve!, manifest_info, project_rel_path

# Version specific imports
@static if VERSION >= v"1.4.0"
    import Pkg.Operations: gen_target_project
else
    import Pkg.Operations: with_dependencies_loadable_at_toplevel
end
@static if VERSION >= v"1.2.0"
    import Pkg.Operations: update_package_test!, source_path, sandbox
else
    import Pkg.Operations: find_installed
    import Pkg.Types: SHA1
end

"""
    gettestfilepath(ctx::Context, pkgspec::Types.PackageSpec)
Gets the testfile path of the package. Code for each Julia version mirrors that found
in `Pkg/src/Operations.jl`.
"""
function gettestfilepath(ctx::Context, pkgspec::Types.PackageSpec)
    @static if VERSION >= v"1.4.0"
        if is_project_uuid(ctx, pkgspec.uuid)
            pkgspec.path = dirname(ctx.env.project_file)
            pkgspec.version = ctx.env.pkg.version
        else
            update_package_test!(pkgspec, manifest_info(ctx, pkgspec.uuid))
            pkgspec.path = project_rel_path(ctx, source_path(ctx, pkgspec))
        end
        pkgfilepath = source_path(ctx, pkgspec)
    elseif VERSION >= v"1.2.0"
        pkgspec.special_action = Pkg.Types.PKGSPEC_TESTED
        if is_project_uuid(ctx.env, pkgspec.uuid)
            pkgspec.path = dirname(ctx.env.project_file)
            pkgspec.version = ctx.env.pkg.version
        else
            update_package_test!(pkgspec, manifest_info(ctx.env, pkgspec.uuid))
            pkgspec.path = joinpath(project_rel_path(ctx, source_path(pkgspec)))
        end
        pkgfilepath = project_rel_path(ctx, source_path(pkgspec))
    elseif VERSION >= v"1.1.0"
        pkgspec.special_action = Pkg.Types.PKGSPEC_TESTED
        if is_project_uuid(ctx.env, pkgspec.uuid)
            pkgspec.version = ctx.env.pkg.version
            pkgfilepath = dirname(ctx.env.project_file)
        else
            entry = manifest_info(ctx.env, pkg.uuid)
            if entry.repo.tree_sha !== nothing
                pkgfilepath = find_installed(pkgspec.name, pkgspec.uuid, entry.repo.tree_sha)
            elseif entry.path !== nothing
                pkgfilepath =  project_rel_path(ctx, entry.path)
            elseif pkgspec.uuid in keys(ctx.stdlibs)
                pkgfilepath = Types.stdlib_path(pkgspec.name)
            else
                throw(PkgTestError("Could not find either `git-tree-sha1` or `path` for package $(pkgspec.name)"))
            end
        end
    else
        pkgspec.special_action = Pkg.Types.PKGSPEC_TESTED
        if is_project_uuid(ctx.env, pkgspec.uuid)
            pkgspec.version = ctx.env.pkg.version
            pkgfilepath = dirname(ctx.env.project_file)
        else
            info = manifest_info(ctx.env, pkgspec.uuid)
            if haskey(info, "git-tree-sha1")
                pkgfilepath = find_installed(pkgspec.name, pkgspec.uuid, SHA1(info["git-tree-sha1"]))
            elseif haskey(info, "path")
                pkgfilepath =  project_rel_path(ctx, info["path"])
            elseif pkgspec.uuid in keys(ctx.stdlibs)
                pkgfilepath = Types.stdlib_path(pkgspec.name)
            else
                throw(PkgTestError("Could not find either `git-tree-sha1` or `path` for package $(pkgspec.name)"))
            end
        end
    end
    testfilepath = joinpath(pkgfilepath, "test", "runtests.jl")
    return testfilepath
end

"""
    isinstalled!(ctx::Union{Context, EnvCache}, pkgspec::Types.PackageSpec)
Checks if the package is installed by using `ensure_resolved` from `Pkg/src/Types.jl`.
This function fails if the package is not installed, but here we wrap it in a
try-catch as we may want to test another package after the one that isn't installed.
For Julia versions V1.4 and later, the first arguments of the Pkg functions used
is of type `Pkg.Types.Context`. For earlier versions, they are of type
`Pkg.Types.EnvCache`.
"""
function isinstalled!(ctx::Context, pkgspec::Types.PackageSpec)
    @static if VERSION >= v"1.4.0"
        var = ctx
    else
        var = ctx.env
    end
    project_resolve!(var, [pkgspec])
    project_deps_resolve!(var, [pkgspec])
    manifest_resolve!(var, [pkgspec])
    try
        ensure_resolved(var, [pkgspec])
    catch
        return false
    end
    return true
end
