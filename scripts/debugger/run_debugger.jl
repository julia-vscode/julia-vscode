# ENV["JULIA_DEBUG"] = "all"

include("debugger.jl")

let
    local pipenames = VSCodeDebugger.clean_up_ARGS_in_launch_mode()
    try
        VSCodeDebugger.startdebug(pipenames[1])
    catch err
        VSCodeDebugger.global_err_handler(err, catch_backtrace(), pipenames[2])
    end
end
