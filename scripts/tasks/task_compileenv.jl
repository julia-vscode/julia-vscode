import Pkg, Libdl, PackageCompiler
import TOML


const config_fname = "vscode-compileenv.toml"

"""
    find_dev_packages(envdir::AbstractString)

Locate the packages that are in `dev` mode for a given project environment.
"""
function find_dev_packages(envdir::AbstractString)
    fname = joinpath(envdir, "Manifest.toml")
    !isfile(fname) && return Symbol[]
    devpkgs = Symbol[]
    parsed = TOML.parse(read(fname, String))
    for key in keys(parsed)
        sub = parsed[key]
        "path" in keys(sub[1]) && push!(devpkgs, Symbol(key))
    end
    devpkgs
end


"""
    read_configuration(envdir)

Read the configuration file `vscode-compileenv.toml` from the environment directory.

This file should look like:

```
[sysimage]
excluded_packages=[]   # Additional packages to be exlucded in the system image
precompile_statements_file=[]  # Precompile statements file to be used
precompile_execution_file=[] # Precompile execution file to be used
```

Please see `PackageCompiler.jl` package's documention for the use of the last two options.
"""
function read_configuration(envdir)
    fname = joinpath(envdir, config_fname)
    output = Dict(
        :precompile_execution_file=>String[],
        :precompile_statements_file=>String[],
        :excluded_packages=>Symbol[],
    )
    !isfile(fname) && return output

    parsed = get(TOML.parse(read(fname, String)), "sysimage", Dict{Any, Any}())
    output[:precompile_execution_file] = String[joinpath(envdir, x) for x in get(parsed, "precompile_execution_file", String[])]
    output[:precompile_statements_file] = String[joinpath(envdir, x) for x in get(parsed, "precompile_statements_file", String[])]
    output[:excluded_packages] = Symbol.(get(parsed, "excluded_packages", Symbol[]))

    output
end

env_to_precompile = ARGS[1]

sysimage_path = joinpath(env_to_precompile, "JuliaSysimage.$(Libdl.dlext)")

project_filename = isfile(joinpath(env_to_precompile, "JuliaProject.toml")) ? joinpath(env_to_precompile, "JuliaProject.toml") : joinpath(env_to_precompile, "Project.toml")

project = Pkg.API.read_project(project_filename)

# Read the configuration file
config = read_configuration(env_to_precompile)
dev_packages = find_dev_packages(env_to_precompile)

# Assemble the arguments for the `create_sysimage` function
used_packages = filter(x -> !(x in dev_packages || x in config[:excluded_packages]), Symbol.(collect(keys(project.deps))))
precompile_statements = config[:precompile_statements_file]
precompile_execution = config[:precompile_execution_file]

@info "Now building a custom sysimage for the environment '$env_to_precompile', excluding dev packages '$dev_packages'."
@info "Precompile statement files: $precompile_statements"
@info "Precompile execution files: $precompile_execution"

PackageCompiler.create_sysimage(used_packages, sysimage_path = sysimage_path, project = env_to_precompile,
                                precompile_statements_file=precompile_statements, precompile_execution_file=precompile_execution)
