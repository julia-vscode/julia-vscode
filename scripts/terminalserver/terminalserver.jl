# this script basially only handles `Base.ARGS`

Base.push!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
using VSCodeServer
pop!(LOAD_PATH)

# load Revise ?
if "USE_REVISE" in Base.ARGS
    try
        @eval using Revise
        Revise.async_steal_repl_backend()
    catch err
        @warn "failed to load Revise: $err"
    end
end

atreplinit() do repl
    "USE_PLOTPANE" in Base.ARGS && Base.Multimedia.pushdisplay(VSCodeServer.InlineDisplay())
end

let
    conn_pipeline, telemetry_pipeline = Base.ARGS[1:2]
    VSCodeServer.serve(conn_pipeline; is_dev = "DEBUG_MODE" in Base.ARGS, crashreporting_pipename = telemetry_pipeline)
end
