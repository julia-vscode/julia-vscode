using Pkg

Pkg.develop([
    PackageSpec(path="../../../packages/CodeTracking"),
    PackageSpec(path="../../../packages/DebugAdapter"),
    PackageSpec(path="../../../packages/JSON"),
    PackageSpec(path="../../../packages/JSONRPC"),
    VERSION >= v"v1.6.0" ? PackageSpec(path="../../../packages/JuliaInterpreter") : PackageSpec(path="../../../packages-old/v1.5/JuliaInterpreter"),
])
