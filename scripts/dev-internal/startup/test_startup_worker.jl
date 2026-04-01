# Worker script for test_startup.jl — runs in a separate process.
# Loads VSCodeServer, calls serve(), collects timings and profile data,
# then writes results to files that the parent process reads.
#
# Arguments (passed via ARGS):
#   conn_pipename debug_pipename results_dir [--profile] [--snoop] [--snoop-invalidations] [--verbose]

const conn_pipename = ARGS[1]
const debug_pipename = ARGS[2]
const results_dir = ARGS[3]
const remaining_args = ARGS[4:end]
const DO_PROFILE = "--profile" in remaining_args
const DO_SNOOP = "--snoop" in remaining_args
const DO_SNOOP_INVALIDATIONS = "--snoop-invalidations" in remaining_args
const VERBOSE = "--verbose" in remaining_args

using Profile

if DO_SNOOP || DO_SNOOP_INVALIDATIONS
    using SnoopCompileCore
end

if DO_PROFILE
    Profile.clear()
    Profile.init(n=10_000_000, delay=0.001)
end

const SCRIPT_DIR = @__DIR__
const PHASE_TIMINGS = Tuple{String,Float64}[]
const T_START = time_ns()

macro timed_phase(name, expr)
    quote
        local t0 = time_ns()
        local result = $(esc(expr))
        local elapsed_ms = (time_ns() - t0) / 1e6
        push!(PHASE_TIMINGS, ($(esc(name)), elapsed_ms))
        if VERBOSE
            @info "Phase complete" phase=$(esc(name)) elapsed_ms=round(elapsed_ms; digits=1)
        end
        result
    end
end

# --- Phase 1: Load VSCodeServer ---

@timed_phase "activate_env" begin
    version_specific_env_path = joinpath(SCRIPT_DIR, "..", "..", "environments", "terminalserver", "v$(VERSION.major).$(VERSION.minor)", "Project.toml")
    if !isfile(version_specific_env_path)
        version_specific_env_path = joinpath(SCRIPT_DIR, "..", "..", "environments", "terminalserver", "fallback", "Project.toml")
    end
    @static if VERSION < v"1.8.0"
        Base.ACTIVE_PROJECT[] = version_specific_env_path
    else
        Base.set_active_project(version_specific_env_path)
    end
end

if DO_SNOOP_INVALIDATIONS
    invs = @snoop_invalidations begin
        @timed_phase "using_VSCodeServer" begin
            using VSCodeServer
        end
    end
else
    @timed_phase "using_VSCodeServer" begin
        using VSCodeServer
    end
end

@timed_phase "deactivate_env" begin
    @static if VERSION < v"1.8.0"
        Base.ACTIVE_PROJECT[] = SCRIPT_DIR
    else
        Base.set_active_project(SCRIPT_DIR)
    end
end

@timed_phase "settings" begin
    VSCodeServer.toggle_plot_pane_notification(nothing, (;enable=true))
    VSCodeServer.toggle_progress_notification(nothing, (;enable=true))
end

# --- Phase 2: Call serve() ---

serve_error = Ref{Any}(nothing)

function do_serve()
    VSCodeServer.serve(
        conn_pipename, debug_pipename;
        is_dev=true,
        error_handler=(err, bt) -> begin
            if VERBOSE
                @error "serve error handler" exception=(err, bt)
            end
        end
    )
end

if DO_SNOOP
    tinf = @snoop_inference do_serve()
elseif DO_PROFILE
    @profile @timed_phase "serve_call" do_serve()
else
    @timed_phase "serve_call" do_serve()
end

# Give async dispatcher task time to record its timings
sleep(5)
yield()

# Pull in serve() internal phase timings
if isdefined(VSCodeServer, :SERVE_TIMINGS) && !isempty(VSCodeServer.SERVE_TIMINGS)
    for (name, ms) in VSCodeServer.SERVE_TIMINGS
        push!(PHASE_TIMINGS, ("  serve/$name", ms))
    end
end

total_ms = (time_ns() - T_START) / 1e6

# --- Write results ---

# Write timings
open(joinpath(results_dir, "timings.txt"), "w") do io
    for (name, ms) in PHASE_TIMINGS
        println(io, name, "\t", ms)
    end
    println(io, "__TOTAL__\t", total_ms)
end

using FileIO
# Write SnoopCompile inference report
if DO_SNOOP
    using SnoopCompile, FlameGraphs

    open(joinpath(results_dir, "snoop_report.txt"), "w") do io
        println(io, "=== SnoopCompile Inference Report ===")
        println(io)
        println(io, "Total inference triggers: ", length(tinf.children))
    end

    fg = flamegraph(tinf)
    FlameGraphs.save(File(format"JLPROF", joinpath(results_dir, "snoop_flamegraph.jlprof")), fg)
end

# Write SnoopCompile invalidations report
if DO_SNOOP_INVALIDATIONS
    using SnoopCompile, AbstractTrees

    trees = invalidation_trees(invs)

    open(joinpath(results_dir, "invalidations_report.txt"), "w") do io
        println(io, "=== SnoopCompile Invalidations Report ===")
        println(io)

        for tree in trees
            println(io, tree, "\n")
        end
    end
end

# Render flame graph HTML
if DO_PROFILE
    try
        using ProfileCanvas
        ProfileCanvas.html_file(joinpath(results_dir, "profile_results.html"); C=false)
    catch err
        @warn "Could not generate ProfileCanvas flame graph" exception=(err, catch_backtrace())
    end
end

# Cleanup
try
    if VSCodeServer.conn_endpoint[] !== nothing
        close(VSCodeServer.conn_endpoint[])
    end
catch; end
