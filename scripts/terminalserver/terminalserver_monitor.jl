#=  Launches the terminal server in a child process. If the child process errors
out, it prompts the user to dismiss the terminal, thereby preserving any output.
=#
try
    opts = Base.JLOptions()
    bin = unsafe_string(opts.julia_bin)
    prj = unsafe_string(opts.project)
    script = joinpath(@__DIR__, "terminalserver.jl")
    run(`$bin -q -i --project=$prj $script $ARGS`, wait = true)
catch e
    msg = "Unexpected error: $e\n\n"
    try
        code = match(r"ProcessExited\(([^\(\)]+)\)", msg)[1]
        msg = "Julia exited with error code $code. "
    catch
    end
    println("$(msg)Press ENTER to dismiss terminal.")
    readline()
end
