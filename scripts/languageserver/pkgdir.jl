using Pkg

c = Pkg.Types.Context()
pkglist = [u[1][string(:path)] for (p,u) in c.env.manifest if haskey(u[1], string(:path))]
if isdir(abspath(joinpath(c.env.manifest_file, "..", "..", "..")))
    println(joinpath(abspath(joinpath(c.env.manifest_file, "..", "..", "..")), "dev"))
elseif !isempty(pkglist)
    println(dirname(pkglist[1]))
else
    println(joinpath(homedir(), ".julia", "dev"))
end