# Common higher-order function calls and comprehensions.
# Each call passes `f` as the callable argument.

const STACK_FUNCTIONS = Set{HOFEntry}()

function _find_module_for(name::Symbol, root::Module)
    seen = Set{Module}()
    queue = Module[root]
    while !isempty(queue)
        m = popfirst!(queue)
        m in seen && continue
        push!(seen, m)
        if isdefined(m, name)
            obj = getfield(m, name)
            (obj isa Function || obj isa Type) && return parentmodule(obj)
        end
        for n in names(m; all=true, imported=false)
            isdefined(m, n) || continue
            obj = getfield(m, n)
            obj isa Module && obj !== m && push!(queue, obj)
        end
    end
    return nothing
end

function f(args...; kwargs...)
    st = stacktrace(backtrace())
    for frame in st
        name = frame.func
        s = string(name)
        startswith(s, '#') && continue
        name === Symbol("top-level scope") && continue
        mod = if frame.linfo isa Core.MethodInstance
            frame.linfo.def.module
        else
            _find_module_for(name, Base)
        end
        mod === nothing && continue
        push!(STACK_FUNCTIONS, HOFEntry(mod, name))
    end
    error("hi")
end

int_data = [1, 2, 3, 4, 5]
str_data = ["foo", "bar", "baz"]
float_data = [1.0, 2.5, 3.7]
char_data = ['a', 'b', 'c']
tuple_data = [(1, 2), (3, 4), (5, 6)]
dict_data = Dict("a" => 1, "b" => 2, "c" => 3)

const EXAMPLES = String[]

for data in ["int_data", "str_data", "float_data", "char_data", "tuple_data"]
    append!(EXAMPLES, [
        # map / map!
        "map(f, $data)",
        "map!(f, similar($data), $data)",
        # filter / filter!
        "filter(f, $data)",
        "filter!(f, copy($data))",
        # foreach
        "foreach(f, $data)",
        # reduce / foldl / foldr
        "reduce(f, $data)",
        "foldl(f, $data)",
        "foldr(f, $data)",
        # mapreduce / mapfoldl / mapfoldr
        "mapreduce(f, +, $data)",
        "mapfoldl(f, *, $data)",
        "mapfoldr(f, *, $data)",
        # any / all / count
        "any(f, $data)",
        "all(f, $data)",
        "count(f, $data)",
        # sum / prod / maximum / minimum / extrema
        "sum(f, $data)",
        "prod(f, $data)",
        "maximum(f, $data)",
        "minimum(f, $data)",
        "extrema(f, $data)",
        # findall / findfirst / findlast
        "findall(f, $data)",
        "findfirst(f, $data)",
        "findlast(f, $data)",
        # sort / sort!
        "sort($data; by=f)",
        "sort($data; lt=f)",
        "sort!(copy($data); by=f)",
        "sort!(copy($data); lt=f)",
        # accumulate / accumulate!
        "accumulate(f, $data)",
        "accumulate!(f, similar($data), $data)",
        # Generator expressions
        "collect(f(x) for x in $data)",
        # Comprehensions
        "[f(x) for x in $data]",
        "[x for x in $data if f(x)]",
    ])
end

append!(EXAMPLES, [
    # map with multiple iterables
    "map(f, int_data, int_data)",
    "map(f, str_data, str_data)",
    # multi-dimensional comprehensions
    "[f(x, y) for x in 1:3, y in 1:3]",
    "[f(x, y) for x in str_data, y in str_data]",
    # Dict-specific
    "filter(f, dict_data)",
    "filter!(f, copy(dict_data))",
    "map(f, keys(dict_data))",
    "map(f, values(dict_data))",
    # Dict comprehension
    "Dict(x => f(x) for x in int_data)",
    "Dict(k => f(v) for (k, v) in dict_data)",
    # Nested comprehension
    "[f(x, y) for x in 1:3 for y in 1:3 if f(x)]",
    # String-specific
    "filter(f, \"hello world\")",
    "map(f, \"hello world\")",
    # open with do-block
    "sprint(f)",
    "f(1)",
    "f(1; a=2)"
])

function _default_arg(p)
    p = p isa UnionAll ? Base.unwrap_unionall(p) : p
    p === Any && return "int_data"
    for (T, expr) in [
        (AbstractDict, "dict_data"),
        (AbstractString, "\"hello\""),
        (AbstractChar, "'a'"),
        (IO, "IOBuffer()"),
        (AbstractVector, "int_data"),
        (AbstractArray, "int_data"),
        (Number, "1"),
        (Integer, "1"),
        (Real, "1.0"),
    ]
        (p isa DataType || p isa UnionAll) && p <: T && return expr
    end
    return "int_data"
end

function generate_examples_for(name::Symbol, mod::Module=Base)
    examples = String[]
    obj = getfield(mod, name)
    for m in methods(obj)
        sig = m.sig isa UnionAll ? Base.unwrap_unionall(m.sig) : m.sig
        params = sig.parameters
        length(params) < 2 && continue
        nargs = length(params) - 1

        args = String["f"]
        for i in 2:nargs
            push!(args, _default_arg(params[i + 1]))
        end

        push!(examples, "$name($(join(args, ", ")))")
        break
    end
    return examples
end

function _covered_names(examples)
    covered = Set{Symbol}()
    for ex in examples
        m = match(r"^(\w+!?)\(", ex)
        m !== nothing && push!(covered, Symbol(m.captures[1]))
    end
    return covered
end

function run_examples(mod::Module=@__MODULE__; extra_hofs::Vector{HOFEntry}=HOFEntry[])
    all_examples = copy(EXAMPLES)

    covered = _covered_names(all_examples)
    for e in extra_hofs
        e.name in covered && continue
        append!(all_examples, generate_examples_for(e.name, e.mod))
    end

    for ex in all_examples
        try
            include_string(mod, ex)
        catch
        end
    end
    return sort!(collect(STACK_FUNCTIONS))
end
