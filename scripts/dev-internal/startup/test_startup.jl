# Test harness for debugging terminalserver.jl and VSCodeServer.serve startup time.
#
# Usage:
#   julia scripts/terminalserver/test_startup.jl [--profile] [--snoop] [--verbose]
#
# This script spawns a separate worker process that:
#   1. Loads VSCodeServer the same way terminalserver.jl does
#   2. Connects to mock named pipes created by this orchestrator
#   3. Calls VSCodeServer.serve() and completes startup
#   4. Reports detailed timing for each startup phase
#   5. Optionally profiles the run and saves a ProfileCanvas flame graph
#   6. Optionally runs SnoopCompile @snoop_inference on serve() to observe type specialization
#
# Options:
#   --profile      Run under the Julia profiler and generate a flame graph HTML
#   --snoop        Run SnoopCompile @snoop_inference on serve() and print top inference triggers
#   --verbose      Print additional debug info

using Sockets

const SCRIPT_DIR = abspath(@__DIR__)
const VERBOSE = "--verbose" in ARGS
const DO_PROFILE = "--profile" in ARGS
const DO_SNOOP = "--snoop" in ARGS

# --- Create mock pipes ---

conn_pipename = ""
debug_pipename = ""

if Sys.iswindows()
    conn_pipename = "\\\\.\\pipe\\vscode-julia-test-conn-$(getpid())"
    debug_pipename = "\\\\.\\pipe\\vscode-julia-test-debug-$(getpid())"
else
    conn_pipename = joinpath(tempdir(), "vscode-julia-test-conn-$(getpid())")
    debug_pipename = joinpath(tempdir(), "vscode-julia-test-debug-$(getpid())")
    for p in (conn_pipename, debug_pipename)
        ispath(p) && rm(p)
    end
end

conn_server = listen(conn_pipename)

# Create temp dir for results
results_dir = mktempdir()

# --- Launch worker process ---

worker_args = String[conn_pipename, debug_pipename, results_dir]
DO_PROFILE && push!(worker_args, "--profile")
DO_SNOOP && push!(worker_args, "--snoop")
VERBOSE && push!(worker_args, "--verbose")

worker_script = joinpath(SCRIPT_DIR, "test_startup_worker.jl")
worker_project_args = DO_SNOOP ? `--project=$(SCRIPT_DIR)` : ``
worker_cmd = `$(Base.julia_cmd()) --startup-file=no $(worker_project_args) $(worker_script) $(worker_args)`

if VERBOSE
    @info "Launching worker" cmd=worker_cmd
end

worker_proc = run(pipeline(worker_cmd; stderr=stderr, stdout=stdout); wait=false)

# --- Mock client: accept connection and wait for "connected" notification ---

conn = accept(conn_server)
if VERBOSE
    @info "Mock client: connection accepted"
end

# Read JSONRPC messages until we see the "connected" notification
while isopen(conn)
    headers = Dict{String,String}()
    while true
        line = readline(conn)
        isempty(line) && break
        if startswith(line, "Content-Length:")
            headers["Content-Length"] = strip(split(line, ":"; limit=2)[2])
        end
    end
    content_length = parse(Int, get(headers, "Content-Length", "0"))
    content_length == 0 && continue
    body = read(conn, content_length)
    msg_str = String(body)
    if VERBOSE
        @info "Mock client: received message" msg=msg_str
    end
    if occursin("\"method\":\"connected\"", msg_str) || occursin("\"method\": \"connected\"", msg_str)
        break
    end
end

# Close connection so the worker can shut down cleanly
try; close(conn); catch; end
try; close(conn_server); catch; end
for p in (conn_pipename, debug_pipename)
    ispath(p) && try; rm(p); catch; end
end

# Wait for worker to finish
wait(worker_proc)

# --- Read and display results ---

timings_file = joinpath(results_dir, "timings.txt")
if !isfile(timings_file)
    @error "Worker did not produce timing results"
    exit(1)
end

phase_timings = Tuple{String,Float64}[]
total_ms = 0.0
for line in readlines(timings_file)
    parts = split(line, "\t")
    length(parts) != 2 && continue
    name, ms_str = parts
    ms = parse(Float64, ms_str)
    if String(name) == "__TOTAL__"
        global total_ms = ms
    else
        push!(phase_timings, (String(name), ms))
    end
end

println()
println("=" ^ 60)
println("  VSCodeServer Startup Timing Report")
println("=" ^ 60)
println()

max_name_len = maximum(length(first(t)) for t in phase_timings; init=0)
for (name, ms) in phase_timings
    bar_len = total_ms > 0 ? round(Int, ms / total_ms * 40) : 0
    bar = "\u2588" ^ bar_len
    println("  $(rpad(name, max_name_len))  $(lpad(string(round(ms; digits=1)), 9)) ms  $bar")
end

println("  $(repeat("\u2500", max_name_len + 15))")
println("  $(rpad("TOTAL", max_name_len))  $(lpad(string(round(total_ms; digits=1)), 9)) ms")
println()

if !isempty(phase_timings)
    worst = phase_timings[argmax(last.(phase_timings))]
    pct = round(worst[2] / total_ms * 100; digits=1)
    println("  Bottleneck: $(worst[1]) ($(pct)% of total)")
end
println()

if DO_PROFILE
    profile_html = joinpath(results_dir, "profile_results.html")
    dest = joinpath(SCRIPT_DIR, "profile_results.html")
    if isfile(profile_html)
        cp(profile_html, dest; force=true)
        println("=" ^ 60)
        println("  Flame graph saved to: $dest")
        println("=" ^ 60)
    else
        @warn "Profile flame graph was not generated by worker"
    end
end

using FileIO
if DO_SNOOP
    snoop_report = joinpath(results_dir, "snoop_report.txt")
    if isfile(snoop_report)
        println()
        print(read(snoop_report, String))
    else
        @warn "SnoopCompile report was not generated by worker"
    end
    snoop_fg_file = joinpath(results_dir, "snoop_flamegraph.jlprof")
    if isfile(snoop_fg_file)
        p = joinpath(@__DIR__, "out.jlprof")
        cp(snoop_fg_file, p; force=true)
        println("  output saved at $p")
        using FlameGraphs, ProfileView, SnoopCompileCore
        fg = FlameGraphs.load(File(format"JLPROF", p))
        ProfileView.view(fg)
        println()
        println("=" ^ 60)
        println("  SnoopCompile flamegraph opened with ProfileView")
        println("=" ^ 60)
    else
        @warn "SnoopCompile flamegraph was not generated by worker"
    end
end
