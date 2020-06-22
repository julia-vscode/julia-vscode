ENV["JULIA_DEBUG"] = "all"

Base.push!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
import VSCodeDebugger
pop!(LOAD_PATH)

let
    local pipenames = VSCodeDebugger.DebugAdapter.clean_up_ARGS_in_launch_mode()
    try
        VSCodeDebugger.DebugAdapter.startdebug(pipenames[1])
    catch err
        VSCodeDebugger.DebugAdapter.global_err_handler(err, catch_backtrace(), pipenames[2], "Debugger")
    end
end
