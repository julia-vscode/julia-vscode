# ENV["JULIA_DEBUG"] = "all"

include("repl_debugger.jl")

try

REPLDebugger.startdebug(ARGS[1])

catch err
    Base.display_error(err, catch_backtrace())
end

println();
println("Finished running, press ENTER to quit.");
readline()
