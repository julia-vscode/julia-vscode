using Sockets

pipename_for_wrapper = ARGS[2]
pipename_for_debugger = ARGS[1]
cwd = ARGS[3]
julia_env = ARGS[4]

@debug "STARTED WRAPPER"

@debug pipename_for_debugger
@debug pipename_for_wrapper

conn = Sockets.connect(pipename_for_wrapper)

@debug "CONNECTED WRAPPER"

jl_cmd = joinpath(Sys.BINDIR, Base.julia_exename())

debugger_script = joinpath(@__DIR__, "run_debugger.jl")

cmd = Cmd(`$jl_cmd --color=yes --project=$julia_env $debugger_script $pipename_for_debugger`, dir=cwd)

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

@debug "We started the debuggee"

wait(p)

println()
printstyled("Julia debuggee finished. Press ENTER to close this terminal.\n", bold=true)

readline()
