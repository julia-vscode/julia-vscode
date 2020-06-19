# TODO support the common profile args here
function view_profile()
    filename = string(uuid4(), ".cpuprofile")
    ChromeProfileFormat.save_cpuprofile(filename)

    # TODO Instead of saving to a file, send content via this message
    # JSONRPC.send(conn_endpoint[], repl_showprofileresult_notification_type, s)
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
