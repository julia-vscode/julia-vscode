using Sockets

pipename_for_wrapper = ARGS[2]
pipename_for_debugger = ARGS[1]

@info "STARTED WRAPPER"

@info pipename_for_debugger
@info pipename_for_wrapper

conn = Sockets.connect(pipename_for_wrapper)

@info "CONNECTED WRAPPER"

jl_cmd = joinpath(Sys.BINDIR, Base.julia_exename())

debugger_script = joinpath(@__DIR__, "run_debugger.jl")

cmd = `$jl_cmd --color=yes $debugger_script $pipename_for_debugger`

p = run(pipeline(cmd, stdin=stdin, stdout=stdout, stderr=stderr), wait=false)

@async begin
    l = readline(conn)

    if l=="TERMINATE"
        @info "NOW KILLING DEBUGGEE"
        kill(p)
        @info "DEBUGGEE IS NO MORE"
    else
        @info "This shouldn't happen"
    end
end

println("WE STARTED THE CLIENT PROCS")

wait(p)

println("NOW WE ARE REALLy dONE")

readline()
