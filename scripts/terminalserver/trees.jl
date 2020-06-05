struct LazyTree
    head::String
    type::String
    children
end

struct SubTree
    head::String
    child
end

LazyTree(head, children) = LazyTree(head, "", children)

struct Leaf
    val
end

const TREES = Dict{Int, LazyTree}()
const ID = Ref(0)

const MAX_PARTITION_LENGTH = 20

treeid() = (ID[] += 1)

function treerender(x::LazyTree)
    id = treeid()
    TREES[id] = x

    return Dict(
        :head => x.head,
        :id => id,
        :haschildren => true,
        :lazy => true,
        :value => "",
        :canshow => false
    )
end

function treerender(x::SubTree)
    child = treerender(x.child)

    return Dict(
        :head => x.head,
        :value => get(child, :head, ""),
        :haschildren => get(child, :haschildren, true),
        :id => get(child, :id, -1),
        :lazy => get(child, :lazy, true),
        :canshow => false
    )
end

function treerender(x::Leaf)
    return Dict(
        :head => x.val,
        :id => -1,
        :value => "",
        :haschildren => false,
        :lazy => false,
        :canshow => false
    )
end

getfield_safe(x, f, default = "#undef") = isdefined(x, f) ? getfield(x, f) : default

function treerender(x)
    fields = fieldnames(typeof(x))

    if isempty(fields)
        treerender(Text(string(typeof(x), "()")))
    else
        treerender(LazyTree(string(typeof(x)), function ()
            [SubTree(string(f), getfield_safe(x, f)) for f in fields]
        end))
    end
end

function treerender(x::AbstractDict{K, V}) where {K, V}
    treerender(LazyTree(string(nameof(typeof(x)), "{$(K), $(V)}"), function ()
        if length(keys(x)) > MAX_PARTITION_LENGTH
            partition_by_keys(x, sz = MAX_PARTITION_LENGTH)
        else
            [SubTree(repr(k), x[k]) for k in keys(x)]
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

            v = getfield(x, n)
            v === x && continue

            push!(out, SubTree(string(n), v))
        end

        out
    end))
end

function treerender(x::AbstractArray)
    treerender(LazyTree(string(typeof(x)), function ()
        if length(x) > MAX_PARTITION_LENGTH
            partition_by_keys(x, sz = MAX_PARTITION_LENGTH)
        else
            vec(x)
        end
    end))
end

treerender(x::Number) = treerender(Leaf(strlimit(repr(x), limit=100)))
treerender(x::AbstractString) = treerender(Leaf(strlimit(repr(x), limit=100)))
treerender(x::AbstractChar) = treerender(Leaf(strlimit(repr(x), limit=100)))
treerender(x::Symbol) = treerender(Leaf(strlimit(repr(x), limit=100)))
treerender(x::Nothing) = treerender(Leaf(strlimit(repr(x), limit=100)))
treerender(x::Missing) = treerender(Leaf(strlimit(repr(x), limit=100)))
treerender(x::Ptr) = treerender(Leaf(string(typeof(x), ": 0x", string(UInt(x), base=16, pad=Sys.WORD_SIZE>>2))))
treerender(x::Text) = treerender(Leaf(x.content))
treerender(x::Function) = treerender(Leaf(string(x)))

function partition_by_keys(x, _keys = keys(x); sz = 20, maxparts = 100)
    partitions = Iterators.partition(_keys, max(sz, length(_keys) ÷ maxparts))
    out = []
    for part in partitions
        if length(part) > sz
            push!(out, LazyTree(string(first(part), " ... ", last(part)), function ()
                partition_by_keys(x, part, sz = sz, maxparts = maxparts)
            end))
        else
            push!(out, LazyTree(string(first(part), " ... ", last(part)), function ()
                [SubTree(repr(k), x[k]) for k in part]
            end))
        end
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
        return ["nope"]
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
