# ENV["JULIA_DEBUG"] = "all"

Base.push!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
import VSCodeDebugger
pop!(LOAD_PATH)

let
    local pipenames = VSCodeDebugger.DebugAdapter.clean_up_ARGS_in_launch_mode()
    try
        @debug "Trying to connect to debug adapter."
        socket = VSCodeDebugger.Sockets.connect(pipenames[1])
        try
            VSCodeDebugger.DebugAdapter.startdebug(socket)
        finally
            close(socket)
        end
    catch err
        VSCodeDebugger.DebugAdapter.global_err_handler(err, catch_backtrace(), pipenames[2], "Debugger")
    end
end
