struct LazyTree
    head::String
    type::String
    children
end

LazyTree(head, children) = LazyTree(head, "", children)

struct Leaf
    val
end

const TREES = Dict{Int, LazyTree}()
const ID = Ref(0)

treeid() = (ID[] += 1)

function treerender(x::LazyTree)
    id = treeid()
    TREES[id] = x

    return Dict(
        :head => x.head,
        :id => id,
        :lazy => true
    )
end

function treerender(x::Leaf)
    return Dict(
        :head => x.val,
        :lazy => false
    )
end

getfield_safe(x, f, default = "#undef") = isdefined(x, f) ? getfield(x, f) : default

function treerender(x)
    fields = fieldnames(typeof(x))

    treerender(LazyTree(string(typeof(x)), function ()
        [LazyTree(string(f), () -> [getfield_safe(x, f)]) for f in fields]
    end))
end

function treerender(x::AbstractDict)
    treerender(LazyTree(string(nameof(typeof(x)), "{$(eltype(x).parameters[1]), $(eltype(x).parameters[2])}"), function ()
        if length(keys(x)) > 25
            partition_by_keys(x)
        else
            [LazyTree(repr(k), () -> [x[k]]) for k in keys(x)]
        end
    end))
end

function treerender(x::Module)
    treerender(LazyTree(string(x), function ()
        ns = names(x, all = true)
        out = []
        for n in ns
            isdefined(x, n) || continue
            Base.isdeprecated(x, n) && continue
            startswith(string(n), '#') && continue
            push!(out, LazyTree(string(n), () -> [getfield(x, n)]))
        end

        out
    end))
end

function treerender(x::AbstractArray)
    treerender(LazyTree(string(nameof(typeof(x))), function ()
        if length(x) > 25
            partition_by_keys(x)
        else
            vec(x)
        end
    end))
end

treerender(x::Number) = treerender(Leaf(strlimit(repr(x))))
treerender(x::AbstractString) = treerender(Leaf(strlimit(repr(x))))
treerender(x::AbstractChar) = treerender(Leaf(strlimit(repr(x))))
treerender(x::Symbol) = treerender(Leaf(strlimit(repr(x))))
treerender(x::Nothing) = treerender(Leaf(strlimit(repr(x))))
treerender(x::Missing) = treerender(Leaf(strlimit(repr(x))))
treerender(x::Ptr) = treerender(Leaf(string(typeof(x), ": 0x", string(UInt(p), base=16, pad=Sys.WORD_SIZE>>2))))

function partition_by_keys(x::AbstractDict; sz = 20)
    _keys = keys(x)
    partitions = Iterators.partition(_keys, sz)
    out = []
    for part in partitions
        push!(out, LazyTree(string(first(part), " ... ", last(part)), function ()
            [LazyTree(repr(k), () -> [x[k]]) for k in part]
        end))
    end
    return out
end

function partition_by_keys(x::AbstractArray; sz = 20)
    _keys = keys(x)
    partitions = Iterators.partition(_keys, sz)
    out = []
    for part in partitions
        push!(out, LazyTree(string(first(part), " ... ", last(part)), function ()
            [x[k] for k in part]
        end))
    end
    return out
end

function get_lazy(id::Int)
    try
        if haskey(TREES, id)
            x = [treerender(x) for x in pop!(TREES, id).children()]
            return x
        else
            return ["[out of date result]"]
        end
    catch err
        @error exception=(err, catch_backtrace())
        return ["nap"]
    end
end

function clear_lazy(ids = [])
    if isempty(ids)
        empty!(TREES)
    else
        for id in ids
            delete!(TREES, id)
        end
    end
end
