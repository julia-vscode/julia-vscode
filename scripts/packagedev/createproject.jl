using Pkg

Pkg.instantiate()

using PkgTemplates

default_plugins = [
    "Project File",
    "Source Directory",
    "Git",
    "License",
    "README",
    "Tests",
    "CompatHelper",
    "TagBot"
]

plugin_lookup = Dict(
    "Project File" => ProjectFile(),
    "Source Directory" => SrcDir(),
    "Git" => Git(),
    "License" => License(),
    "README" => Readme(),
    "Tests" => Tests(),
    "CompatHelper" => CompatHelper(),
    "TagBot" => TagBot(),
    "AppVeyor" => AppVeyor(),
    "BlueStyleBadge" => BlueStyleBadge(),
    "CirrusCI" => CirrusCI(),
    "Citation" => Citation(),
    "Codecov" => Codecov(),
    "ColPracBadge" => ColPracBadge(),
    "Coveralls" => Coveralls(),
    # "Develop" => Develop(),
    "Documenter" => Documenter(),
    "DroneCI" => DroneCI(),
    "GitHubActions" => GitHubActions(),
    "GitLabCI" => GitLabCI(),
    "PkgEvalBadge" => PkgEvalBadge(),
    "RegisterAction" => RegisterAction(),
    "TravisCI" => TravisCI()
)

try
    kwargs = Dict{Symbol, Any}()
    pkg_name = ARGS[1]
    kwargs[:dir] = ARGS[2]
    if ARGS[3] != ""
        kwargs[:authors] = split(ARGS[3], ',')
    end
    if ARGS[4] != ""
        kwargs[:host] = ARGS[4]
    end
    user = ARGS[5]
    if user != ""
        kwargs[:user] = user
    end
    if ARGS[6] != ""
        kwargs[:julia] = VersionNumber(ARGS[6])
    end

    plugin_args = String[]
    plugins = []
    if length(ARGS) > 6
        plugin_args = ARGS[7:end]
        for p in plugin_args
            if user == "" && PkgTemplates.needs_username(plugin_lookup[p])
                continue
            end
            push!(plugins, plugin_lookup[p])
        end
    end

    for p in default_plugins
        default_excluded = length(plugin_args) > 0 && !(p in plugin_args)
        needs_user = user == "" && PkgTemplates.needs_username(plugin_lookup[p])
        if default_excluded || needs_user
            push!(plugins, !typeof(plugin_lookup[p])) # Defaults must be negated to disable
        end
    end
    kwargs[:plugins] = plugins

    Template(;kwargs...)(pkg_name)
catch err
    Base.display_error(err, catch_backtrace())
    sleep(5) # Gives some time to see the error before terminal disappears
end
