using Pkg

Pkg.add("Pkg")
Pkg.develop(PackageSpec(path="../../../packages/AutoHashEquals"),)
Pkg.develop(PackageSpec(path="../../../packages/CoverageTools"),)
Pkg.develop(PackageSpec(path="../../../packages/JSON"),)
Pkg.develop(PackageSpec(path="../../../packages/JSONRPC"),)
Pkg.develop(PackageSpec(path="../../../packages/TestItemControllers"),)
Pkg.develop(PackageSpec(path="../../../packages/URIParser"),)
