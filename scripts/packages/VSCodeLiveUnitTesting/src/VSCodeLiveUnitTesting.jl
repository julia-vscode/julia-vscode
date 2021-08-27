module VSCodeLiveUnitTesting

include("../../OrderedCollections/src/OrderedCollections.jl")
include("../../CodeTracking/src/CodeTracking.jl")

module JuliaInterpreter
    using ..CodeTracking

    include("../../JuliaInterpreter/src/packagedef.jl")
end

module LoweredCodeUtils
    using ..JuliaInterpreter
    using ..JuliaInterpreter: SSAValue, SlotNumber, Frame
    using ..JuliaInterpreter: @lookup, moduleof, pc_expr, step_expr!, is_global_ref, whichtt,
                        next_until!, finish_and_return!, nstatements, codelocation,
                        is_return, lookup_return, is_GotoIfNot, is_ReturnNode

    include("../../LoweredCodeUtils/src/packagedef.jl")
end

module Revise
    using ..OrderedCollections
    using ..CodeTracking
    using ..JuliaInterpreter
    using ..LoweredCodeUtils

    using ..CodeTracking: PkgFiles, basedir, srcfiles, line_is_decl, basepath
    using ..JuliaInterpreter: whichtt, is_doc_expr, step_expr!, finish_and_return!, get_return,
                        @lookup, moduleof, scopeof, pc_expr, is_quotenode_egal,
                        linetable, codelocs, LineTypes, is_GotoIfNot, isassign, isidentical
    using ..LoweredCodeUtils: next_or_nothing!, trackedheads, structheads, callee_matches

    include("../../Revise/src/packagedef.jl")
end

include("copied_from_test_reports.jl")

function run_test_loop(test_file::AbstractString)
    Pkg.status()

    println()

    test_folder = dirname(test_file)

    try
        cd(test_folder)
        VSCodeLiveUnitTesting.Revise.track(test_file; mode=:eval, skip_include=false)
    catch err
        Base.display_error(err, catch_backtrace())
    end

    VSCodeLiveUnitTesting.Revise.entr([test_file]; all=true, postpone=true) do
        println()
        println("Rerunning tests...")
        println()

        try
            cd(test_folder)
            VSCodeLiveUnitTesting.Revise.include(test_file)
        catch err
            Base.display_error(err, catch_backtrace())
        end
    end
end

function live_unit_test(pkg_name::AbstractString, test_file::AbstractString)
    absolute_path_of_test_file = joinpath(pwd(), test_file)

    pkgspec = deepcopy(Pkg.PackageSpec(pkg_name))

    ctx = Pkg.API.Context()

    if !isinstalled!(ctx, pkgspec)
        error("Package not in here")
    end

    Pkg.instantiate(ctx)

    testfilepath = gettestfilepath(ctx, pkgspec)

    if !isfile(testfilepath)
        error("")
    end

    test_folder_has_project_file = isfile(joinpath(dirname(testfilepath), "Project.toml"))

    if VERSION >= v"1.4.0" || (VERSION >= v"1.2.0" && test_folder_has_project_file)
        # Operations.sandbox() has different arguments between versions
        sandbox_args = (ctx,
                            pkgspec,
                            pkgspec.path,
                            joinpath(pkgspec.path, "test"))

        if VERSION >= v"1.4.0"
            test_project_override = test_folder_has_project_file ?
                    nothing :
                    gen_target_project(ctx, pkgspec, pkgspec.path, "test")

            sandbox_args = (sandbox_args..., test_project_override)
        end

        sandbox(sandbox_args...) do
            run_test_loop(absolute_path_of_test_file)
        end
    else
        with_dependencies_loadable_at_toplevel(ctx, pkgspec; might_need_to_resolve=true) do localctx
            Pkg.activate(localctx.env.project_file)
            try
                run_test_loop(absolute_path_of_test_file)
            finally
                Pkg.activate(ctx.env.project_file)
            end
        end
    end
end

end
