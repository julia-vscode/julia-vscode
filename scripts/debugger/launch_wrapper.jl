using Sockets

pipename_for_wrapper = ARGS[2]
pipename_for_debugger = ARGS[1]
cwd = ARGS[3]
julia_env = ARGS[4]
pipename_for_crashreporting = ARGS[5]

conn = Sockets.connect(pipename_for_wrapper)

jl_cmd = joinpath(Sys.BINDIR, Base.julia_exename())

debugger_script = joinpath(@__DIR__, "run_debugger.jl")

cmd = Cmd(`$jl_cmd --color=yes --history-file=no --startup-file=no --project=$julia_env $debugger_script $pipename_for_debugger $pipename_for_crashreporting`, dir=cwd)

p = run(pipeline(cmd, stdin=stdin, stdout=stdout, stderr=stderr), wait=false)

@async begin
    l = readline(conn)

    if l == "TERMINATE"
        kill(p)
    else
        error("Invalid state.")
    end
end


wait(p)

println()
printstyled("Julia debuggee finished. Press ENTER to close this terminal.\n", bold=true)

readline()
