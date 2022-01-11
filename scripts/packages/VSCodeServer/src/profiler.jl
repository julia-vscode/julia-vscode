using FlameGraphs

function view_profile(period::Union{Nothing,UInt64} = nothing; kwargs...)
    # if data !== nothing && isempty(data)
    #     @info "No profile data collected."
    #     return
    # end
    @info "view_profile called"

    d = Dict()
    for thread in ["all"] #["all", 1:Threads.nthreads()...]
        d[thread] = tojson(flamegraph())
    end

    @info "dict prepared"

    JSONRPC.send(conn_endpoint[], repl_showprofileresult_notification_type, (; trace = d))
    @info "dict sent"
end

function tojson(node, root = false)
    name = string(node.data.sf.file)

    Dict(
        :meta => Dict(
            :func => node.data.sf.func,
            :file => basename(name),
            :path => fullpath(name),
            :line => node.data.sf.line,
            :count => root ? sum(length(c.data.span) for c in node) : length(node.data.span),
            :flags => node.data.status
        ),
        :children => sort!([tojson(c) for c in node], by = node -> node[:meta][:count], rev = true)
    )
end

"""
    @profview f(args...)

Clear the Profile buffer, profile `f(args...)`, and view the result graphically.
"""
macro profview(ex, args...)
    return quote
        Profile.clear()
        Profile.@profile $(esc(ex))
        view_profile(; $(esc.(args)...))
    end
end
