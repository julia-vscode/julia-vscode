using Pkg

mktempdir() do p
    cp(joinpath(pwd(), "docs", "Project.toml"), joinpath(p, "Project.toml"))

    Pkg.activate(p)

    Pkg.develop(PackageSpec(path = pwd()))
    Pkg.instantiate()

    include(Base.ARGS[1])
end

Sys.isapple() ? run(`open $(Base.ARGS[2])`) : Sys.iswindows() ? run(`cmd /c start $(Base.ARGS[2])`) : Sys.islinux() ? run(`xdg-open $(Base.ARGS[2])`) : nothing
