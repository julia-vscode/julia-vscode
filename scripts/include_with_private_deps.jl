# Include the unmodified entry file of a bundled package (e.g. `Foo/src/Foo.jl`) into
# `mod`, stripping the top level `module Foo ... end` wrapper and rewriting
# `using`/`import` statements of bundled dependencies to relative imports so they
# resolve to already loaded private copies instead of going through `Base.require`.
# A dependency counts as bundled if a module with the same name is bound in `mod` or
# in `parentmodule(mod)`. `include` calls are rewritten so that nested files get the
# same treatment (except the module stripping). Usage:
#
#     module JSONRPC end
#     include_with_private_deps(JSONRPC, "../../JSONRPC/src/JSONRPC.jl")
#
# `mod` must have the same name as the package's top level module. Not handled:
# `using`/`import` inside nested `module` blocks and `include` calls that are not
# syntactically visible at the top level (e.g. inside functions).
function include_with_private_deps(mod::Module, path::AbstractString)
    return Base.include(ex -> _strip_package_module(mod, ex), mod, path)
end

function _strip_package_module(mod::Module, ex)
    # Unwrap a docstring attached to the module (the docstring is discarded).
    if Meta.isexpr(ex, :macrocall, 4) &&
            (ex.args[1] === GlobalRef(Core, Symbol("@doc")) || ex.args[1] === Symbol("@doc")) &&
            Meta.isexpr(ex.args[4], :module)
        ex = ex.args[4]
    end
    if Meta.isexpr(ex, :module, 3)
        body = ex.args[3]::Expr
        return Expr(:toplevel, map(x -> _rewrite_for_private_deps(mod, x), body.args)...)
    end
    return _rewrite_for_private_deps(mod, ex)
end

function _rewrite_for_private_deps(mod::Module, ex)
    ex isa Expr || return ex
    if ex.head === :using || ex.head === :import
        return Expr(ex.head, map(a -> _rewrite_import_target(mod, a), ex.args)...)
    elseif Meta.isexpr(ex, :call) && ex.args[1] === :include && 2 <= length(ex.args) <= 3
        # include([mapexpr,] path) -> _include_rewritten([mapexpr,] mod, path)
        return Expr(:call, _include_rewritten, ex.args[2:end-1]..., mod, ex.args[end])
    elseif ex.head === :block || ex.head === :if || ex.head === :elseif || ex.head === :toplevel
        return Expr(ex.head, map(x -> _rewrite_for_private_deps(mod, x), ex.args)...)
    elseif Meta.isexpr(ex, :macrocall) && ex.args[1] === Symbol("@static")
        return Expr(:macrocall, ex.args[1], ex.args[2],
            map(x -> _rewrite_for_private_deps(mod, x), ex.args[3:end])...)
    end
    return ex
end

function _include_rewritten(mod::Module, path::AbstractString)
    return Base.include(ex -> _rewrite_for_private_deps(mod, ex), mod, path)
end
function _include_rewritten(mapexpr, mod::Module, path::AbstractString)
    return Base.include(ex -> _rewrite_for_private_deps(mod, mapexpr(ex)), mod, path)
end

# An argument of `using`/`import` is a plain module path (`import A.B`), a `:` clause
# (`using A: b, c`) where only the first argument is the module path, or an `as`
# clause (`import A as B`).
function _rewrite_import_target(mod::Module, ex)
    if Meta.isexpr(ex, :(:)) && !isempty(ex.args)
        return Expr(:(:), _rewrite_module_path(mod, ex.args[1]), ex.args[2:end]...)
    elseif Meta.isexpr(ex, :as, 2)
        return Expr(:as, _rewrite_module_path(mod, ex.args[1]), ex.args[2])
    else
        return _rewrite_module_path(mod, ex)
    end
end

function _rewrite_module_path(mod::Module, ex)
    if Meta.isexpr(ex, :.) && !isempty(ex.args) && ex.args[1] isa Symbol && ex.args[1] !== :.
        ndots = _private_dep_dots(mod, ex.args[1]::Symbol)
        if ndots > 0
            return Expr(:., fill(:., ndots)..., ex.args...)
        end
    end
    return ex
end

# Leading dots needed to reach the private copy of the dependency `name`:
# 1 (`using .Foo`) if bound in `mod` itself, 2 (`using ..Foo`) if bound in the parent
# module, 0 if there is no private copy (leave the statement alone).
function _private_dep_dots(mod::Module, name::Symbol)
    if isdefined(mod, name) && getfield(mod, name) isa Module
        return 1
    end
    parent = parentmodule(mod)
    if parent !== mod && isdefined(parent, name) && getfield(parent, name) isa Module
        return 2
    end
    return 0
end
