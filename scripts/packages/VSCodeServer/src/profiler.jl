function view_profile(data = Profile.fetch(); C=false, kwargs...)
    d = Dict()

    if VERSION >= v"1.8.0-DEV.460"
        threads = ["all", 1:Threads.nthreads()...]
    else
        threads = ["all"]
    end

    if isempty(data)
        Profile.warning_empty()
        return
    end

    lidict = Profile.getdict(unique(data))
    data_u64 = convert(Vector{UInt64}, data)
    for thread in threads
        graph = stackframetree(data_u64, lidict; thread=thread, kwargs...)
        d[thread] = dicttree(Dict(
                :func => "root",
                :file => "",
                :path => "",
                :line => 0,
                :count => graph.count,
                :flags => 0x0,
                :children => []
            ), graph; C=C, kwargs...)
    end

    JSONRPC.send(conn_endpoint[], repl_showprofileresult_notification_type, (; trace=d))
end

function stackframetree(data_u64, lidict; thread=nothing, combine=true, recur=:off)
    root = combine ? Profile.StackFrameTree{Profile.StackFrame}() : Profile.StackFrameTree{UInt64}()
    if VERSION >= v"1.8.0-DEV.460"
        thread = thread == "all" ? (1:Threads.nthreads()) : thread
        root, _ = Profile.tree!(root, data_u64, lidict, true, recur, thread)
    else
        root = Profile.tree!(root, data_u64, lidict, true, recur)
    end
    if !isempty(root.down)
        root.count = sum(pr -> pr.second.count, root.down)
    end

    return root
end

# https://github.com/timholy/FlameGraphs.jl/blob/master/src/graph.jl
const runtime_dispatch = UInt8(2^0)
const gc_event = UInt8(2^1)
const repl = UInt8(2^2)
const compilation = UInt8(2^3)
const task_event = UInt8(2^4)
# const              = UInt8(2^5)
# const              = UInt8(2^6)
# const              = UInt8(2^7)
# const              = UInt8(2^8)

function status(sf::Profile.StackFrame)
    st = UInt8(0)
    if sf.from_c && (sf.func === :jl_invoke || sf.func === :jl_apply_generic || sf.func === :ijl_apply_generic)
        st |= runtime_dispatch
    end
    if sf.from_c && startswith(String(sf.func), "jl_gc_")
        st |= gc_event
    end
    if !sf.from_c && sf.func === :eval_user_input && endswith(String(sf.file), "REPL.jl")
        st |= repl
    end
    if !sf.from_c && occursin("./compiler/", String(sf.file))
        st |= compilation
    end
    if !sf.from_c && occursin("task.jl", String(sf.file))
        st |= task_event
    end
    return st
end

function status(node::Profile.StackFrameTree, C::Bool)
    st = status(node.frame)
    C && return st
    # If we're suppressing C frames, check all C-frame children
    for child in values(node.down)
        child.frame.from_c || continue
        st |= status(child, C)
    end
    return st
end

function add_child(graph, node, C::Bool)
    name = string(node.frame.file)
    func = String(node.frame.func)

    if func == ""
        func = "unknown"
    end

    d = Dict(
        :func => func,
        :file => basename(name),
        :path => fullpath(name),
        :line => node.frame.line,
        :count => node.count,
        :flags => status(node, C),
        :children => []
    )
    push!(graph[:children], d)

    return d
end

function dicttree(graph, node::Profile.StackFrameTree; C=false)
    for child_node in sort!(collect(values(node.down)); rev=true, by=node -> node.count)
        # child not a hidden frame
        if C || !child_node.frame.from_c
            child = add_child(graph, child_node, C)
            dicttree(child, child_node; C=C)
        else
            dicttree(graph, child_node)
        end
    end

    return graph
end

"""
    @profview f(args...) [C = false]

Clear the Profile buffer, profile `f(args...)`, and view the result graphically.

The default of `C = false` will only show Julia frames in the profile graph.
"""
macro profview(ex, args...)
    return quote
        Profile.clear()
        Profile.@profile $(esc(ex))
        view_profile(; $(esc.(args)...))
    end
end

## Allocs

"""
    @profview_allocs f(args...) [sample_rate=0.0001] [C=false]

Clear the Profile buffer, profile `f(args...)`, and view the result graphically.
"""
macro profview_allocs(ex, args...)
    sample_rate_expr = :(sample_rate=0.0001)
    for arg in args
        if Meta.isexpr(arg, :(=)) && length(arg.args) > 0 && arg.args[1] === :sample_rate
            sample_rate_expr = arg
        end
    end
    if isdefined(Profile, :Allocs)
        return quote
            Profile.Allocs.clear()
            Profile.Allocs.@profile $(esc(sample_rate_expr)) $(esc(ex))
            view_alloc_profile()
        end
    else
        return :(@error "This version of Julia does not support the allocation profiler.")
    end
end

function view_alloc_profile(_results=Profile.Allocs.fetch(); C=false)
    results = _results::Profile.Allocs.AllocResults
    allocs = results.allocs

    root = Dict(
        :func => "root",
        :file => "",
        :path => "",
        :line => 0,
        :count => 0,
        :scaledCount => 0,
        :flags => 0x0,
        :children => Dict()
    )
    for alloc in allocs
        this = root
        for (i, sf) in enumerate(Iterators.reverse(alloc.stacktrace))
            if !C && sf.from_c
                continue
            end
            file = string(sf.file)
            this = get!(this[:children], hash(sf), Dict(
                :func => sf.func,
                :file => basename(file),
                :path => fullpath(file),
                :line => sf.line,
                :count => 0,
        :scaledCount => 0,
                :flags => 0x0,
                :children => Dict()
            ))
            this[:count] += alloc.size
            this[:scaledCount] += scaler(alloc.size)
        end
        this[:children][rand()] = Dict(
            :func => replace(string(alloc.type), "Profile.Allocs." => ""),
            :file => "",
            :path => "",
            :line => 0,
            :count => alloc.size,
            :scaledCount => scaler(alloc.size),
            :flags => 0x2,
            :children => Dict()
        )
        root[:count] += alloc.size
        root[:scaledCount] += scaler(alloc.size)
    end

    postprocess!(root, root[:count])

    d = Dict{Any, Any}(
        "all" => root
    )

    JSONRPC.send(conn_endpoint[], repl_showprofileresult_notification_type, (; trace=d))
end

scaler(x) = x^(1/5)

function postprocess!(root, parent_count)
    root[:children] = postprocess!.(values(root[:children]), Ref(root[:scaledCount]))
    root[:countLabel] = memory_size(root[:count])
    root[:fraction] = root[:scaledCount]/parent_count

    return root
end

const prefixes = ["bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"]
function memory_size(size)
    i = 1
    while size > 1000 && i + 1 < length(prefixes)
        size /= 1000
        i += 1
    end
    return string(round(Int, size), " ", prefixes[i])
end
