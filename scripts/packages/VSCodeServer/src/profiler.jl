function view_profile(; C = false, kwargs...)
    d = Dict()

    if VERSION >= v"1.8.0-DEV.460"
        threads = ["all", 1:Threads.nthreads()...]
    else
        threads = ["all"]
    end
    data = Profile.fetch()

    if isempty(data)
        Profile.warning_empty()
        return
    end

    lidict = Profile.getdict(unique(data))
    data_u64 = convert(Vector{UInt64}, data)
    for thread in threads
        graph = stackframetree(data_u64, lidict; thread = thread, kwargs...)
        d[thread] = dicttree(Dict(
            :func => "root",
            :file => "",
            :path => "",
            :line => 0,
            :count => graph.count,
            :flags => 0x0,
            :children => []
        ), graph; C = C, kwargs...)
    end

    JSONRPC.send(conn_endpoint[], repl_showprofileresult_notification_type, (; trace = d))
end

function stackframetree(data_u64, lidict; thread = nothing, combine = true, recur = :off)
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
const gc_event         = UInt8(2^1)
const repl             = UInt8(2^2)
const compilation      = UInt8(2^3)
const task_event       = UInt8(2^4)
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

function dicttree(graph, node::Profile.StackFrameTree; C = false)
    for child_node in sort!(collect(values(node.down)); rev = true, by = node -> node.count)
        # child not a hidden frame
        if C || !child_node.frame.from_c
            child = add_child(graph, child_node, C)
            dicttree(child, child_node; C = C)
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
