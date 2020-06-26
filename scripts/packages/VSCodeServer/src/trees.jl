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

pluralize(n::Int, one, more=one) = string(n, " ", n == 1 ? one : more)
pluralize(::Tuple{}, one, more=one) = string(0, " ", more)
pluralize(n, one, more=one) = string(length(n) > 1 ? join(n, '×') : first(n), " ", prod(n) == 1 ? one : more)

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

getfield_safe(x, f, default="#undef") = isdefined(x, f) ? getfield(x, f) : default

function treerender(x)
    fields = fieldnames(typeof(x))

    if isempty(fields)
        treerender(Text(string(typeof(x), "()")))
    else
        treerender(LazyTree(string(typeof(x)), wsicon(x), function ()
            out = []
            for f in fields
                str = try
                    Base.invokelatest(string, f)
                catch err
                    @error err
                    Base.invokelatest(string, err)
                end

                item = SubTree(str, wsicon(getfield_safe(x, f)), getfield_safe(x, f))

                push!(out, item)
            end
        end))
    end
end

function treerender(x::Module)
    treerender(LazyTree(string(x), wsicon(x), function ()
        ns = names(x, all=true)
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

function treerender(x::AbstractDict{K,V}) where {K,V}
    keylength = try
        Base.invokelatest(length ∘ keys, x)
    catch err
        @error err
        return treerender(SubTree(string(typeof(x)), wsicon(x), string(err)))
    end

    treerender(LazyTree(string(nameof(typeof(x)), "{$(K), $(V)} with $(pluralize(keylength, "element", "elements"))"), wsicon(x), keylength, function ()
        if keylength > MAX_PARTITION_LENGTH
            partition_by_keys(x, sz=MAX_PARTITION_LENGTH)
        else
            child_list(x)
        end
    end))
end

function treerender(x::AbstractArray{T,N}) where {T,N}
    size_of_x = try
        Base.invokelatest(size, x)
    catch err
        @error err
        return treerender(SubTree(string(typeof(x)), wsicon(x), err))
    end

    length_of_x = prod(size_of_x)

    treerender(LazyTree(string(typeof(x), " with $(pluralize(size_of_x, "element", "elements"))"), wsicon(x), length_of_x == 0, function ()
        if length_of_x > MAX_PARTITION_LENGTH
            partition_by_keys(x, sz=MAX_PARTITION_LENGTH)
        else
            child_list(zip(keys(x), vec(x)))
        end
    end))
end

function treerender(x::Union{Number, AbstractString, AbstractChar})
    rep = try
        Base.invokelatest(repr, x)
    catch err
        @error err
        string(err)
    end
    treerender(Leaf(strlimit(rep, limit=100), wsicon(x)))
end

treerender(x::Symbol) = treerender(Leaf(strlimit(repr(x), limit=100), wsicon(x)))
treerender(x::Nothing) = treerender(Leaf(strlimit(repr(x), limit=100), wsicon(x)))
treerender(x::Missing) = treerender(Leaf(strlimit(repr(x), limit=100), wsicon(x)))
treerender(x::Ptr) = treerender(Leaf(string(typeof(x), ": 0x", string(UInt(x), base=16, pad=Sys.WORD_SIZE >> 2)), wsicon(x)))
treerender(x::Text) = treerender(Leaf(x.content, wsicon(x)))
treerender(x::Function) = treerender(Leaf(strlimit(string(x), limit=100), wsicon(x)))
treerender(x::Type) = treerender(Leaf(strlimit(string(x), limit=100), wsicon(x)))

function partition_by_keys(x, _keys=keys(x); sz=20, maxparts=100)
    partitions = Iterators.partition(_keys, max(sz, length(_keys) ÷ maxparts))
    out = []
    for part in partitions
        head = string(repr(first(part)), " ... ", repr(last(part)))
        if length(part) > sz
            push!(out, LazyTree(head, function ()
                partition_by_keys(x, collect(part), sz=sz, maxparts=maxparts)
            end))
        else
            push!(out, LazyTree(head, function ()
                child_list(zip(part, getindex.(Ref(x), part)))
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

        s = Base.invokelatest(string, n)
        startswith(s, "#") && continue

        try
            push!(variables, Base.invokelatest(treerender, SubTree(s, wsicon(x), x)))
        catch err
            @error err
            printstyled("Internal Error: ", bold=true, color=Base.error_color())
            Base.display_error(err, catch_backtrace())
        end
    end

    return variables
end

function clear_lazy(ids=[])
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
            return [Base.invokelatest(treerender, x) for x in pop!(TREES, id).children]
        else
            return ["[out of date result]"]
        end
    catch err
        @error Base.invokelatest(string, err)
        return [Base.invokelatest(string, err)]
    end
end

function child_list(itr)
    out = []
    for (k, v) in itr
        rep = try
            Base.invokelatest(repr, k)
        catch err
            @error err
            Base.invokelatest(string, err)
        end
        item = SubTree(rep, wsicon(v), v)

        push!(out, item)
    end
    out
end
