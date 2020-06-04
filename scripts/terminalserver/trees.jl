struct LazyTree
    head::String
    children
end

const TREES = Dict{Int, LazyTree}()
const ID = Ref(0)

treeid() = (ID += 1)

function treerender(x::LazyTree)
    id = treeid()
    TREES[id] = x

    return Dict(
        :head => x.head,
        :id => id,
        :lazy => true
    )
end

getfield_safe(x, f, default = "#undef") = isdefined(x, f) ? getfield(x, f) : default

function treerender(x)
    fields = fieldnames(typeof(x))

    treerender(LazyTree(typeof(x), function ()
        [LazyTree(string(f), getfield_safe(x, f)) for f in fields]
    end))
end

function treerender(x::AbstractDict)
    treerender(LazyTree(string(nameof(typeof(x))), function ()
        partition_by_keys(x)
    end))
end

function treerender(x::AbstractArray)
    treerender(LazyTree(string(nameof(typeof(x))), function ()
        partition_by_keys(x)
    end))
end

treerender(x::Number) = Dict("head" => strlimit(repr(x)))
treerender(x::AbstractString) = Dict("head" => strlimit(repr(x)))
treerender(x::AbstractChar) = Dict("head" => strlimit(repr(x)))
treerender(x::Symbol) = Dict("head" => strlimit(repr(x)))
treerender(x::Nothing) = Dict("head" => strlimit(repr(x)))
treerender(x::Missing) = Dict("head" => strlimit(repr(x)))

function partition_by_keys(x::AbstractDict; sz = 10)
    _keys = keys(x)
    partitions = Iterators.partition(_keys, sz)
    out = []
    for part in partitions
        push!(out, LazyTree(string(first(part), " ... ", last(part)), function ()
            [LazyTree(string(k), () -> treerender(x[k])) for k in part]
        end))
    end
    return out
end

function partition_by_keys(x::AbstractArray; sz = 10)
    _keys = keys(x)
    partitions = Iterators.partition(_keys, sz)
    out = []
    for part in partitions
        push!(out, LazyTree(string(first(part), " ... ", last(part)), function ()
            [treerender(x[k])) for k in part]
        end))
    end
    return out
end

function get_lazy(id::Int)
    if haskey(TREES, id)
        return [treerender(x) for x in pop!(TREES, id).children()]
    else
        return ["[out of date result]"]
    end
end

function clear_lazy(ids = [])
    if isempty(ids)
        empty!(TREES)
    else
        for id in ids
            delete!(trees, id)
        end
    end
end
