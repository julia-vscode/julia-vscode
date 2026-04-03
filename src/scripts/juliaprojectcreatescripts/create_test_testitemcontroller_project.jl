using Pkg

Pkg.develop([
    PackageSpec(path="../../../packages/TestItemControllers"),
    PackageSpec(path="../../../packages/LoggingExtras"),
    PackageSpec(path="../../../packages/VSCodeErrorLoggers")
])
