using Pkg

Pkg.develop([
    PackageSpec(path="../../../packages/CSTParser"),
    PackageSpec(path="../../../packages/CommonMark"),
    PackageSpec(path="../../../packages/Compat"),
    PackageSpec(path="../../../packages/Crayons"),
    PackageSpec(path="../../../packages/DataStructures"),
    PackageSpec(path="../../../packages/FilePathsBase"),
    PackageSpec(path="../../../packages/JSON"),
    PackageSpec(path="../../../packages/JSONRPC"),
    PackageSpec(path="../../../packages/Glob"),
    PackageSpec(path="../../../packages/JuliaFormatter"),
    PackageSpec(path="../../../packages/LanguageServer"),
    PackageSpec(path="../../../packages/OrderedCollections"),
    PackageSpec(path="../../../packages/StaticLint"),
    PackageSpec(path="../../../packages/SymbolServer"),
    PackageSpec(path="../../../packages/Tokenize"),
    PackageSpec(path="../../../packages/URIParser"),
    PackageSpec(path="../../../packages/URIs"),
    PackageSpec(path="../../../packages/TestItemDetection"),
])
