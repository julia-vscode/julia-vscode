# List all higher-order functions in Base by inspecting method signatures.
# A higher-order function is one that accepts a Function argument.
# We use two strategies:
#   1. Check parameter types for Function supertypes.
#   2. Check argument names for callable-like names (f, func, pred, ...).

const CALLABLE_ARG_NAMES = Set{Symbol}([:f, :func, :fn, :pred, :predicate, :cmp, :comp, :by, :lt, :op])

function _is_callable_type(p)
    p = p isa UnionAll ? Base.unwrap_unionall(p) : p
    p === Function && return true
    p isa Union && Function <: p && return true
    return false
end

function find_higher_order_functions(mod::Module=Base)
    results = Set{HOFEntry}()

    for name in names(mod; all=false, imported=false)
        isdefined(mod, name) || continue
        obj = getfield(mod, name)
        obj isa Function || continue

        for m in methods(obj)
            sig = m.sig isa UnionAll ? Base.unwrap_unionall(m.sig) : m.sig
            params = sig.parameters
            argnames = Base.method_argnames(m)
            # params[1] / argnames[1] is the function itself; first arg is at [2]
            length(params) < 2 && continue
            p = params[2]
            p = p isa UnionAll ? Base.unwrap_unionall(p) : p

            entry = HOFEntry(parentmodule(obj), name)

            # Strategy 1: first argument type is constrained to be callable
            if _is_callable_type(p)
                push!(results, entry)
                @goto next_func
            end

            # Strategy 2: first argument type is Any but name suggests a callable
            if p === Any && length(argnames) >= 2 && argnames[2] in CALLABLE_ARG_NAMES
                push!(results, entry)
                @goto next_func
            end
        end
        @label next_func
    end

    return sort!(collect(results))
end

