# ENV["JULIA_DEBUG"] = "all"

include("debugger.jl")

try
    VSCodeDebugger.startdebug(VSCodeDebugger.clean_up_ARGS_in_launch_mode())
catch err
    Base.display_error(err, catch_backtrace())
end
