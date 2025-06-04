using Profile

# https://github.com/timholy/FlameGraphs.jl/blob/master/src/graph.jl
const ProfileFrameFlag = (
    RuntimeDispatch = UInt8(2^0),
    GCEvent = UInt8(2^1),
    REPL = UInt8(2^2),
    Compilation = UInt8(2^3),
    TaskEvent = UInt8(2^4)
)

function view_profile(data = Profile.fetch(); C=false, kwargs...)
    d = Dict{String,ProfileFrame}()

    if VERSION >= v"1.8.0-DEV.460"
        all_tids = sort([Threads.threadpooltids(:interactive)..., Threads.threadpooltids(:default)...])
        threads = [nothing, all_tids...]
    else
        threads = [nothing]
    end

    if isempty(data)
        Profile.warning_empty()
        return
    end

    lidict = Profile.getdict(unique(data))
    data_u64 = convert(Vector{UInt64}, data)
    for thread in threads
        graph = stackframetree(data_u64, lidict; thread=thread, kwargs...)
        threadname = if thread === nothing
            "All threads"
        else
            "$(thread) ($(Threads.threadpool(thread)))"
        end
        d[threadname] = make_tree(
            ProfileFrame(
                "root", "", "", 0, graph.count, missing, 0x0, missing, ProfileFrame[]
            ), graph; C=C)
    end

    JSONRPC.send(conn_endpoint[], repl_showprofileresult_notification_type, (; trace=d, typ="Thread"))
end

function stackframetree(data_u64, lidict; thread=nothing, combine=true, recur=:off)
    root = combine ? Profile.StackFrameTree{StackTraces.StackFrame}() : Profile.StackFrameTree{UInt64}()
    if VERSION >= v"1.8.0-DEV.460"
        root, _ = Profile.tree!(root, data_u64, lidict, true, recur, thread)
    else
        root = Profile.tree!(root, data_u64, lidict, true, recur)
    end
    if !isempty(root.down)
        root.count = sum(pr -> pr.second.count, root.down)
    end

    return root
end

function status(sf::StackTraces.StackFrame)
    st = UInt8(0)
    if sf.from_c && (sf.func === :jl_invoke || sf.func === :jl_apply_generic || sf.func === :ijl_apply_generic)
        st |= ProfileFrameFlag.RuntimeDispatch
    end
    if sf.from_c && startswith(String(sf.func), "jl_gc_")
        st |= ProfileFrameFlag.GCEvent
    end
    if !sf.from_c && sf.func === :eval_user_input && endswith(String(sf.file), "REPL.jl")
        st |= ProfileFrameFlag.REPL
    end
    if !sf.from_c && occursin("./compiler/", String(sf.file))
        st |= ProfileFrameFlag.Compilation
    end
    if !sf.from_c && occursin("task.jl", String(sf.file))
        st |= ProfileFrameFlag.TaskEvent
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

function add_child(graph::ProfileFrame, node, C::Bool)
    name = string(node.frame.file)
    func = String(node.frame.func)

    if func == ""
        func = "unknown"
    end

    frame = ProfileFrame(
        func,
        basename(name),
        fullpath(name),
        node.frame.line,
        node.count,
        missing,
        status(node, C),
        missing,
        ProfileFrame[]
    )

    push!(graph.children, frame)

    return frame
end

function make_tree(graph, node::Profile.StackFrameTree; C=false)
    for child_node in sort!(collect(values(node.down)); rev=true, by=node -> node.count)
        # child not a hidden frame
        if C || !child_node.frame.from_c
            child = add_child(graph, child_node, C)
            make_tree(child, child_node; C=C)
        else
            make_tree(graph, child_node)
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
            view_profile_allocs()
        end
    else
        return :(@error "This version of Julia does not support the allocation profiler.")
    end
end

function view_profile_allocs(_results=Profile.Allocs.fetch(); C=false)
    results = _results::Profile.Allocs.AllocResults
    allocs = results.allocs

    allocs_root = ProfileFrame("root", "", "", 0, 0, missing, 0x0, missing, ProfileFrame[])
    counts_root = ProfileFrame("root", "", "", 0, 0, missing, 0x0, missing, ProfileFrame[])
    for alloc in allocs
        this_allocs = allocs_root
        this_counts = counts_root

        for sf in Iterators.reverse(alloc.stacktrace)
            if !C && sf.from_c
                continue
            end
            file = string(sf.file)
            this_counts′ = ProfileFrame(
                string(sf.func), basename(file), fullpath(file),
                sf.line, 0, missing, 0x0, missing, ProfileFrame[]
            )
            ind = findfirst(c -> (
                    c.func == this_counts′.func &&
                    c.path == this_counts′.path &&
                    c.line == this_counts′.line
                ), this_allocs.children)

            this_counts, this_allocs = if ind === nothing
                push!(this_counts.children, this_counts′)
                this_allocs′ = deepcopy(this_counts′)
                push!(this_allocs.children, this_allocs′)

                (this_counts′, this_allocs′)
            else
                (this_counts.children[ind], this_allocs.children[ind])
            end
            this_allocs.count += alloc.size
            this_allocs.countLabel = memory_size(this_allocs.count)
            this_counts.count += 1
        end

        alloc_type = replace(string(alloc.type), "Profile.Allocs." => "")
        ind = findfirst(c -> (c.func == alloc_type), this_allocs.children)
        if ind === nothing
            push!(this_allocs.children, ProfileFrame(
                alloc_type, "", "",
                0, this_allocs.count, memory_size(this_allocs.count), ProfileFrameFlag.GCEvent, missing, ProfileFrame[]
            ))
            push!(this_counts.children, ProfileFrame(
                alloc_type, "", "",
                0, 1, missing, ProfileFrameFlag.GCEvent, missing, ProfileFrame[]
            ))
        else
            this_counts.children[ind].count += 1
            this_allocs.children[ind].count += alloc.size
            this_allocs.children[ind].countLabel = memory_size(this_allocs.children[ind].count)
        end

        counts_root.count += 1
        allocs_root.count += alloc.size
        allocs_root.countLabel = memory_size(allocs_root.count)
    end

    d = Dict{String, ProfileFrame}(
        "size" => allocs_root,
        "count" => counts_root
    )

    JSONRPC.send(conn_endpoint[], repl_showprofileresult_notification_type, (; trace=d, typ="Allocation"))
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
