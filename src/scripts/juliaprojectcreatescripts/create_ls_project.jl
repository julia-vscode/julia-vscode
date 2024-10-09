using Pkg

packages_to_dev = [
    PackageSpec(path="../../../packages/AutoHashEquals"),
    PackageSpec(path="../../../packages/CancellationTokens"),
    PackageSpec(path="../../../packages/CSTParser"),
    PackageSpec(path="../../../packages/CommonMark"),
    PackageSpec(path="../../../packages/Compat"),
    PackageSpec(path="../../../packages/Crayons"),
    PackageSpec(path="../../../packages/DataStructures"),
    PackageSpec(path="../../../packages/DelimitedFiles"),
    PackageSpec(path="../../../packages/Glob"),
    PackageSpec(path="../../../packages/FilePathsBase"),
    PackageSpec(path="../../../packages/JSON"),
    PackageSpec(path="../../../packages/JSONRPC"),
    PackageSpec(path="../../../packages/JuliaFormatter"),
    PackageSpec(path="../../../packages/JuliaSyntax"),
    PackageSpec(path="../../../packages/JuliaWorkspaces"),
    PackageSpec(path="../../../packages/LanguageServer"),
    PackageSpec(path="../../../packages/OrderedCollections"),
    PackageSpec(path="../../../packages/PrecompileTools"),
    PackageSpec(path="../../../packages/Preferences"),
    PackageSpec(path="../../../packages/StaticLint"),
    PackageSpec(path="../../../packages/SymbolServer"),
    PackageSpec(path="../../../packages/Tokenize"),
    PackageSpec(path="../../../packages/URIParser"),
    PackageSpec(path="../../../packages/URIs"),
    PackageSpec(path="../../../packages/ExceptionUnwrapping"),
    PackageSpec(path="../../../packages/MacroTools"),
    PackageSpec(path="../../../packages/Salsa"),
    PackageSpec(path="../../../packages/TestItemDetection"),
]

Pkg.develop(packages_to_dev)
