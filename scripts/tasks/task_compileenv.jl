import Pkg, Libdl, PackageCompiler

env_to_precompile = ARGS[1]

sysimage_path = joinpath(env_to_precompile, "JuliaSysimage.$(Libdl.dlext)")

project_filename = isfile(joinpath(env_to_precompile, "JuliaProject.toml")) ? joinpath(env_to_precompile, "JuliaProject.toml") : joinpath(env_to_precompile, "Project.toml")

project = Pkg.API.read_project(project_filename)

used_packages = Symbol.(collect(keys(project.deps)))

@info "Now building a custom sysimage for the environment '$env_to_precompile'."

PackageCompiler.create_sysimage(used_packages, sysimage_path = sysimage_path, project = env_to_precompile)
