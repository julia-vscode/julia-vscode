#=  Launches the terminal server in a child process. On termination, the user is
prompted to restart.
=#

const always_terminate_on_success = parse(Bool, popfirst!(ARGS))
const opts = Base.JLOptions()
const bin = unsafe_string(opts.julia_bin)
const prj = unsafe_string(opts.project)
const script = joinpath(@__DIR__, "terminalserver.jl")
const cmd = `$bin -q -i --project=$prj $script $ARGS`

let done = false
    while !done

        # run subprocess
        try
            run(cmd, wait = true)
            if always_terminate_on_success
                done = true
            else
                println("Julia exited normally.")
            end
        catch e
            msg = "Unexpected error: $e"
            matches = match(r"ProcessExited\(([^\(\)]+)\)", msg)
            if !isnothing(matches)
                msg = "Julia exited with error code $(matches[1])."
            end
            println(msg)
        end

        # ask for restart
        while !done
            print("Restart? [Y/n] ")
            ans = lowercase(readline())
            if length(ans) == 0 || ans[1] == 'y'
                break
            elseif ans[1] == 'n'
                done = true
            end
        end
    end
end
