struct LazyTree
    head::String
    icon::String
    isempty::Bool
    children
end

LazyTree(head, children) = LazyTree(head, "", false, children)
LazyTree(head, icon::String, children) = LazyTree(head, icon, false, children)

struct SubTree
    head::String
    icon::String
    child
end

SubTree(head, child) = LazyTree(head, "", child)

struct Leaf
    val
    icon::String
end

Leaf(val) = Leaf(val, "")

const TREES = Dict{Int,LazyTree}()
const ID = Ref(0)

const MAX_PARTITION_LENGTH = 20

treeid() = (ID[] += 1)

pluralize(n::Int, one, more = one) = string(n, " ", n == 1 ? one : more)
pluralize(::Tuple{}, one, more = one) = string(0, " ", more)
pluralize(n, one, more = one) = string(length(n) > 1 ? join(n, '×') : first(n), " ", prod(n) == 1 ? one : more)

function treerender(x::LazyTree)
    id = treeid()
    TREES[id] = x

    return ReplWorkspaceItem(
        x.head,
        id,
        !(x.isempty),
        true,
        x.icon,
        "",
        false,
        ""
    )
end

function treerender(x::SubTree)
    child = treerender(x.child)

    return ReplWorkspaceItem(
        x.head,
        child.id,
        child.haschildren,
        child.lazy,
        child.icon,
        child.head,
        false,
        ""
    )
end

function treerender(x::Leaf)
    return ReplWorkspaceItem(
        x.val,
        -1,
        false,
        false,
        x.icon,
        "",
        false,
        ""
    )
end

getfield_safe(x, f, default = "#undef") = isdefined(x, f) ? getfield(x, f) : default

function treerender(x)
    fields = fieldnames(typeof(x))

    if isempty(fields)
        treerender(Text(string(typeof(x), "()")))
    else
        treerender(LazyTree(string(typeof(x)), wsicon(x), function ()
            [SubTree(string(f), wsicon(getfield_safe(x, f)), getfield_safe(x, f)) for f in fields]
        end))
    end
end

function treerender(x::AbstractDict{K,V}) where {K,V}
    treerender(LazyTree(string(nameof(typeof(x)), "{$(K), $(V)} with $(pluralize(length(keys(x)), "element", "elements"))"), wsicon(x), length(keys(x)) == 0, function ()
        if length(keys(x)) > MAX_PARTITION_LENGTH
            partition_by_keys(x, sz = MAX_PARTITION_LENGTH)
        else
            [SubTree(repr(k), wsicon(v), v) for (k, v) in x]
        end
    end))
end

function treerender(x::Module)
    treerender(LazyTree(string(x), wsicon(x), function ()
        ns = names(x, all = true)
        out = []
        for n in ns
            isdefined(x, n) || continue
            Base.isdeprecated(x, n) && continue
            startswith(string(n), '#') && continue

            v = getfield(x, n)
            v === x && continue

            push!(out, SubTree(string(n), wsicon(v), v))
        end

        out
    end))
end

function treerender(x::AbstractArray{T,N}) where {T,N}
    treerender(LazyTree(string(typeof(x), " with $(pluralize(size(x), "element", "elements"))"), wsicon(x), length(x) == 0, function ()
        if length(x) > MAX_PARTITION_LENGTH
            partition_by_keys(x, sz = MAX_PARTITION_LENGTH)
        else
            [SubTree(repr(k), wsicon(v), v) for (k, v) in zip(keys(x), vec(x))]
        end
    end))
end

treerender(x::Number) = treerender(Leaf(strlimit(repr(x), limit = 100), wsicon(x)))
treerender(x::AbstractString) = treerender(Leaf(strlimit(repr(x), limit = 100), wsicon(x)))
treerender(x::AbstractChar) = treerender(Leaf(strlimit(repr(x), limit = 100), wsicon(x)))
treerender(x::Symbol) = treerender(Leaf(strlimit(repr(x), limit = 100), wsicon(x)))
treerender(x::Nothing) = treerender(Leaf(strlimit(repr(x), limit = 100), wsicon(x)))
treerender(x::Missing) = treerender(Leaf(strlimit(repr(x), limit = 100), wsicon(x)))
treerender(x::Ptr) = treerender(Leaf(string(typeof(x), ": 0x", string(UInt(x), base = 16, pad = Sys.WORD_SIZE >> 2)), wsicon(x)))
treerender(x::Text) = treerender(Leaf(x.content, wsicon(x)))
treerender(x::Function) = treerender(Leaf(strlimit(string(x), limit = 100), wsicon(x)))
treerender(x::Type) = treerender(Leaf(strlimit(string(x), limit = 100), wsicon(x)))

function partition_by_keys(x, _keys = keys(x); sz = 20, maxparts = 100)
    partitions = Iterators.partition(_keys, max(sz, length(_keys) ÷ maxparts))
    out = []
    for part in partitions
        head = string(repr(first(part)), " ... ", repr(last(part)))
        if length(part) > sz
            push!(out, LazyTree(head, function ()
                partition_by_keys(x, collect(part), sz = sz, maxparts = maxparts)
            end))
        else
            push!(out, LazyTree(head, function ()
                [SubTree(repr(k), wsicon(v), v) for (k, v) in zip(part, getindex.(Ref(x), part))]
            end))
        end
    end
    return out
end

# workspace

function repl_getvariables_request(conn, params::Nothing)
    M = Main
    variables = []
    clear_lazy()

    for n in names(M, all=true, imported=true)
        !isdefined(M, n) && continue
        Base.isdeprecated(M, n) && continue

        x = getfield(M, n)
        x === vscodedisplay && continue
        x === VSCodeServer && continue
        x === Main && continue

        s = string(n)
        startswith(s, "#") && continue
        try
            push!(variables, treerender(SubTree(s, wsicon(x), x)))
        catch err
            printstyled("Internal Error: ", bold = true, color = Base.error_color())
            Base.display_error(err, catch_backtrace())
        end
    end

    return variables
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

wsicon(::Any) = "symbol-variable"
wsicon(::Module) = "symbol-namespace"
wsicon(f::Function) = "symbol-method"
wsicon(::Number) = "symbol-numeric"
wsicon(::AbstractString) = "symbol-string"
wsicon(::AbstractArray) = "symbol-array"
wsicon(::Type) = "symbol-structure"
wsicon(::AbstractDict) = "symbol-enum"
wsicon(::Exception) = "warning"

# handle lazy clicks

repl_getlazy_request(conn, params::Int) = get_lazy(params)

function get_lazy(id::Int)
    try
        if haskey(TREES, id)
            x = [Base.invokelatest(treerender, x) for x in Base.invokelatest(pop!(TREES, id).children)]
            return x
        else
            return ["[out of date result]"]
        end
    catch err
        printstyled("Internal Error: ", bold = true, color = Base.error_color())
        Base.display_error(err, catch_backtrace())
        return []
    end
end
