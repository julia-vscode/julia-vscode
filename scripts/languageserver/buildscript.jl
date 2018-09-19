pkgpath = joinpath(dirname(@__FILE__), "packages")
pushfirst!(LOAD_PATH, pkgpath)
using StaticLint
StaticLint.SymbolServer.save_pkg_store(StaticLint.storedir)