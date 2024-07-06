using Pkg

packages_to_dev = [
    PackageSpec(path="../../../packages/CSTParser"),
    PackageSpec(path="../../../packages/CommonMark"),
    PackageSpec(path="../../../packages/DataStructures"),
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

if VERSION>=v"1.9-DEV"
    push!(packages_to_dev, PackageSpec(path="../../../packages/DelimitedFiles"))
end

if VERSION>=v"1.6.0"
    push!(packages_to_dev, PackageSpec(path="../../../packages/Compat"))
    push!(packages_to_dev, PackageSpec(path="../../../packages/Crayons"))
else
    push!(packages_to_dev, PackageSpec(path="../../../packages-old/Compat"))
    push!(packages_to_dev, PackageSpec(path="../../../packages-old/Crayons"))
end

if VERSION>=v"1.8.0"
    push!(packages_to_dev, PackageSpec(path="../../../packages/AutoHashEquals"))
else
    push!(packages_to_dev, PackageSpec(path="../../../packages-old/v1.7/AutoHashEquals"))
end

Pkg.develop(packages_to_dev)
