# TODO Instead of saving to a file, send content via this message
function view_profile(data::Union{Nothing,Vector{UInt}}=nothing, period::Union{Nothing,UInt64}=nothing; kwargs...)
    # This way of finding a filename has a race condition, but for now we ignore because
    # we want to replace this with a non-file based solution soon.
    filename = nothing
    try
        filename = first("profile_result_$i.cpuprofile" for i = 1:1000 if !isfile("profile_result_$i.cpuprofile"))
    catch err
    end

    if filename !== nothing
        ChromeProfileFormat.save_cpuprofile(filename, data, period, kwargs...)
        println("Profile saved as $(joinpath(pwd(), filename)).")
    else
        println("Could not create a file for profiling results.")
    end

    # JSONRPC.send(conn_endpoint[], repl_showprofileresult_notification_type, joinpath(pwd(), filename))
end


"""
    @profview f(args...)

Clear the Profile buffer, profile `f(args...)`, and view the result graphically.
"""
macro profview(ex, args...)
    return quote
        Profile.clear()
        Profile.@profile $(esc(ex))
        view_profile(;$(esc.(args)...))
    end
end
