using Pkg, Libdl
import PackageCompiler

pkg_ctx = Pkg.Types.Context()

mktempdir() do temp_dir
    precompile_temp_file_name = joinpath(temp_dir, "temp_file_for_compile.jl")

    used_packages = Set(keys(pkg_ctx.env.project.deps))

    usings = """
        using $(join(used_packages, ','))
        for Mod in [$used_packages]
            isdefined(Mod, :__init__) && Mod.__init__()
        end
        """

    open(precompile_temp_file_name, "w") do out_file
        println(out_file, """
            # We need to use all used packages in the precompile file for maximum
            # usage of the precompile statements.
            # Since this can be any recursive dependency of the package we AOT compile,
            # we decided to just use them without installing them. An added
            # benefit is, that we can call __init__ this way more easily, since
            # incremental sysimage compilation won't call __init__ on `using`
            # https://github.com/JuliaLang/julia/issues/22910
            $usings
            # bring recursive dependencies of used packages and standard libraries into namespace
            for Mod in Base.loaded_modules_array()
                if !Core.isdefined(@__MODULE__, nameof(Mod))
                    Core.eval(@__MODULE__, Expr(:const, Expr(:(=), nameof(Mod), Mod)))
                end
            end
            """)
    end

    systemp = joinpath(temp_dir, "sys.a")

    sysout = joinpath(dirname(pkg_ctx.env.project_file), "JuliaSysimage.$(Libdl.dlext)")
    
    code = PackageCompiler.PrecompileCommand(precompile_temp_file_name)

    @info "Running Julia to create sysimage..."

    PackageCompiler.run_julia(code, O = 3, output_o = systemp, g = 1,
            track_allocation = "none", startup_file = "no", code_coverage = "none",
            project = replace(dirname(pkg_ctx.env.project_file), '\\' => '/'))

    @info "Building shared library..."

    PackageCompiler.build_shared(sysout, systemp, false, PackageCompiler.sysimg_folder(), true, "3", false, PackageCompiler.system_compiler, nothing)
end
