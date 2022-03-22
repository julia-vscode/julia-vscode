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
    pkg_name = ARGS[1]
    dir = ARGS[2]
    authors = split(ARGS[3], ',')
    host = ARGS[4]
    user = ARGS[5]
    julia = VersionNumber(ARGS[6])

    plugin_args = String[]
    plugins = []
    if length(ARGS) > 6
        plugin_args = ARGS[7:end]
        for p in plugin_args
            push!(plugins, plugin_lookup[p])
        end
    end
    # Defaults must be negated to disable
    for p in default_plugins
        if !(p in plugin_args)
            push!(plugins, !typeof(plugin_lookup[p]))
        end
    end
    Template(; user=user, authors=authors, dir=dir, host=host, julia=julia, plugins=plugins)(pkg_name)
catch err
    Base.display_error(err, catch_backtrace())
end
