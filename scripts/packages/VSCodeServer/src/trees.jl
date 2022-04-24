struct LazyTree
    head::String
    icon::String
    isempty::Bool
    children::Any
    location::Union{Location, Nothing}
end

LazyTree(head, children) = LazyTree(head, "", false, children, nothing)
LazyTree(head, icon::String, children) = LazyTree(head, icon, false, children, nothing)
LazyTree(head, icon::String, children, location) = LazyTree(head, icon, false, children, location)

struct SubTree
    head::String
    icon::String
    child::Any
    location::Union{Location, Nothing}
end

SubTree(head, child) = SubTree(head, "", child, location(child))
SubTree(head, icon, child) = SubTree(head, icon, child, location(child))

struct Leaf
    val::Any
    icon::String
    location::Union{Location, Nothing}
end

Leaf(val) = Leaf(val, "", nothing)
Leaf(val, icon) = Leaf(val, icon, nothing)

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
        "",
        x.location
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
        "",
        x.location
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
        "",
        x.location
    )
end

getfield_safe(x, f, default = UNDEF) = isdefined(x, f) ? getfield(x, f) : default

struct PropertyBox
    object::Any
end
treerender(x::PropertyBox) = invoke(treerender, Tuple{Any,String,String}, x.object, "#properties", wsicon(x))

function treerender(x, typedisplay = typeof(x), icon = wsicon(x))
    fields = fieldnames(typeof(x))

    if isempty(fields)
        treerender(Text(string(typedisplay, "()")))
    else
        treerender(LazyTree(string(typedisplay), icon,
                () -> [SubTree(string(f), wsicon(getfield_safe(x, f)), getfield_safe(x, f)) for f in fields]
            ))
    end
end

function treerender(x::AbstractDict{K,V}) where {K,V}
    treerender(LazyTree(string(nameof(typeof(x)), "{$(K), $(V)} with $(pluralize(length(keys(x)), "element", "elements"))"), wsicon(x), length(keys(x)) == 0,
            () -> pushfirst!(
                if length(keys(x)) > MAX_PARTITION_LENGTH
                    partition_by_keys(x, sz = MAX_PARTITION_LENGTH)
                else
                    # collect is necessary because the return type of an array comprehension depends on the iterator,
                    # but we only want Arrays here
                    collect([SubTree(repr(k), wsicon(v), v) for (k, v) in x])
                end,
                SubTree("", wsicon(x), PropertyBox(x))
            ),
            nothing
        ))
end

function treerender(x::AbstractArray{T,N}) where {T,N}
    treerender(LazyTree(string(typeof(x), " with $(pluralize(size(x), "element", "elements"))"), wsicon(x), length(x) == 0,
            function ()
                out = if length(x) > MAX_PARTITION_LENGTH
                    partition_by_keys(x, sz = MAX_PARTITION_LENGTH)
                else
                    # collect is necessary because the return type of an array comprehension depends on the iterator,
                    # but we only want Arrays here
                    collect([SubTree(repr(k), wsicon(v), v) for (k, v) in zip(keys(x), vec(assign_undefs(x)))])
                end
                x isa Array ? out : pushfirst!(out, SubTree("", wsicon(x), PropertyBox(x)))
            end,
            nothing
        ))
end


function treerender(x::Module)
    loc = location(x)

    treerender(
        LazyTree(
            string(x),
            wsicon(x),
            function ()
                ns = names(x, all=true)
                out = SubTree[]
                for n in ns
                    isdefined(x, n) || continue
                    Base.isdeprecated(x, n) && continue
                    startswith(string(n), '#') && continue

                    v = getfield(x, n)
                    v === x && continue

                    push!(out, SubTree(string(n), wsicon(v), v))
                end

                return out
            end,
            loc
        )
    )
end

struct Undef end

const UNDEF = Undef()

function assign_undefs(xs)
    s = size(xs)
    xs′ = Array{Any,length(s)}(undef, s...)
    for i in eachindex(xs)
        xs′[i] = isassigned(xs, i) ? xs[i] : UNDEF
    end

    # make sure not to leave any unassigned locations around even when
    # `similar` (i.e. `size`) and `eachindex` disagree; `prod(size(x)) ==
    # length(eachindex(x))` should hold, but doesn't always
    for i in eachindex(xs′)
        if !isassigned(xs′, i)
            xs′[i] = UNDEF
        end
    end

    return xs′
end

function treerender(err::Exception, bt)
    st = stacktrace(bt)
    treerender(LazyTree(string("Internal Error: ", sprint(showerror, err)), wsicon(err), length(st) == 0, () -> [Leaf(sprint(show, x), wsicon(x)) for x in st], nothing))
end

treerender(x::Number) = treerender(Leaf(strlimit(repr(x), limit = 100), wsicon(x)))
treerender(x::AbstractString) = treerender(Leaf(strlimit(repr(x), limit = 100), wsicon(x)))
treerender(x::AbstractChar) = treerender(Leaf(strlimit(repr(x), limit = 100), wsicon(x)))
treerender(x::Symbol) = treerender(Leaf(strlimit(repr(x), limit = 100), wsicon(x)))
treerender(x::Nothing) = treerender(Leaf(strlimit(repr(x), limit = 100), wsicon(x)))
treerender(x::Missing) = treerender(Leaf(strlimit(repr(x), limit = 100), wsicon(x)))
treerender(x::Ptr) = treerender(Leaf(string(typeof(x), ": 0x", string(UInt(x), base = 16, pad = Sys.WORD_SIZE >> 2)), wsicon(x)))
treerender(x::Text) = treerender(Leaf(x.content, wsicon(x)))
treerender(x::Type) = treerender(Leaf(strlimit(string(x), limit = 100), wsicon(x)))
treerender(x::Undef) = treerender(Leaf("#undef", wsicon(x)))
treerender(x::StackTraces.StackFrame) = treerender(Leaf(string(x), wsicon(x)))
treerender(x::Enum) = treerender(Leaf(sprint(show, MIME"text/plain"(), x), wsicon(x)))

function treerender(x::Function)
    treerender(LazyTree(
        strlimit(string(x), limit=100),
        wsicon(x),
        function ()
            try
                collect(methods(x))
            catch err
                []
            end
        end
    ))
end

function treerender(x::Method)
    m = match(r"^(.+) in (.+) at (.+)$", string(x))
    mstr = m === nothing ? "unknown" : strlimit(m[1]; limit=100)

    treerender(Leaf(mstr, wsicon(x), location(x)))
end

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
                        # collect is necessary because the return type of an array comprehension depends on the iterator,
                        # but we only want Arrays here
                        collect([SubTree(repr(k), wsicon(v), v) for (k, v) in zip(part, getindex.(Ref(x), assign_undefs(part)))])
                    end))
        end
    end
    return out
end

# can't get runtime location info for most objects
location(_) = nothing
# we don't attach location info to modules,
# but for non-baremodules we can just look at
# eval instead
location(m::Module) = isdefined(m, :eval) ? location(first(methods(m.eval))) : nothing
function location(m::Method)
    file = fullpath(string(m.file))
    if isfile(file)
        loc = Location(file, m.line)
    else
        loc = nothing
    end
end

# workspace

repl_getvariables_request(conn, params::Nothing) = Base.invokelatest(getvariables)

function getvariables()
    M = Main
    variables = ReplWorkspaceItem[]
    clear_lazy()

    for n in names(M, all = true, imported = true)
        !isdefined(M, n) && continue
        Base.isdeprecated(M, n) && continue

        x = getfield(M, n)
        any(isequal(x), (
            vscodedisplay,
            VSCodeServer,
            Main,
            Main.include,
            Main.eval
        )) && continue

        s = string(n)
        startswith(s, "#") && continue
        try
            tree = treerender(SubTree(s, wsicon(x), x))
            tree.canshow = can_display(x)
            push!(variables, tree)
        catch err
            # FIXME: This should end up in the tree view as an "error child".
            # Ref: https://github.com/julia-vscode/julia-vscode/issues/1491
            #
            # printstyled("Internal Error: ", bold=true, color=Base.error_color())
            # Base.display_error(err, catch_backtrace())
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
wsicon(::Function) = "symbol-function"
wsicon(::Method) = "symbol-method"
wsicon(::Number) = "symbol-numeric"
wsicon(::Bool) = "symbol-boolean"
wsicon(::AbstractString) = "symbol-string"
wsicon(::AbstractArray) = "symbol-array"
wsicon(::Type) = "symbol-structure"
wsicon(::AbstractDict) = "symbol-enum"
wsicon(::Enum) = "symbol-enum"
wsicon(::Exception) = "warning"
wsicon(::Undef) = "question"

# handle lazy clicks

repl_getlazy_request(conn, params::NamedTuple{(:id,),Tuple{Int}}) = Base.invokelatest(get_lazy, params.id)

function get_lazy(id::Int)
    try
        if haskey(TREES, id)
            x = [treerender(x) for x in pop!(TREES, id).children()]
            return x
        else
            return [treerender(Text("[out of date result]"))]
        end
    catch err
        # show internal error in workspace:
        return [treerender(err, catch_backtrace())]
    end
end
