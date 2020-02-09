using Sockets

pipename_for_wrapper = ARGS[2]
pipename_for_debugger = ARGS[1]

@debug "STARTED WRAPPER"

@debug pipename_for_debugger
@debug pipename_for_wrapper

conn = Sockets.connect(pipename_for_wrapper)

@debug "CONNECTED WRAPPER"

jl_cmd = joinpath(Sys.BINDIR, Base.julia_exename())

debugger_script = joinpath(@__DIR__, "run_debugger.jl")

cmd = `$jl_cmd --color=yes $debugger_script $pipename_for_debugger`

p = run(pipeline(cmd, stdin=stdin, stdout=stdout, stderr=stderr), wait=false)

@async begin
    l = readline(conn)

    if l=="TERMINATE"
        @debug "NOW KILLING DEBUGGEE"
        kill(p)
        @debug "DEBUGGEE IS NO MORE"
    else
        @debug "This shouldn't happen"
    end
end

@debug "We started the client proc"

wait(p)

println()
printstyled("Julia debuggee finished. Press ENTER to close this terminal.\n", bold=true)

readline()
