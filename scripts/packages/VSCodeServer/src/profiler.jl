# TODO Instead of saving to a file, send content via this message
function view_profile(data::Union{Nothing,Vector{UInt}} = copy(Profile.fetch()), period::Union{Nothing,UInt64} = nothing; kwargs...)
    if data !== nothing && isempty(data)
        @info "No profile data collected."
        return
    end
    filename = string(tempname(), ".cpuprofile")

    ChromeProfileFormat.save_cpuprofile(filename, data, period, kwargs...)

    JSONRPC.send(conn_endpoint[], repl_showprofileresult_file_notification_type, (; filename = filename))
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
