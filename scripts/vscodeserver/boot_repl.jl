# this script basially only handles `Base.ARGS`

# XXX: is this needed ?
!(Sys.isunix() || Sys.iswindows()) && error("Unknown operating system.")

# suppress Pkg.jl's messages
let
    old = stderr
    rd, wr = redirect_stderr()
    err = nothing
    try
        using Pkg
        Pkg.activate(@__DIR__)
        using vscodeserver
        Pkg.activate() # back to default env
    catch e
        @error e
    finally
        redirect_stderr(old)
        close(wr)
        close(rd)
    end
end

# load Revise ?
if "USE_REVISE" in Base.ARGS
    try
        @eval using Revise
        Revise.async_steal_repl_backend()
    catch err
        @warn "failed to load Revise: $err"
    end
end

"USE_PLOTPANE" in Base.ARGS && Base.Multimedia.pushdisplay(vscodeserver.InlineDisplay())

let
    # TODO: enable telemetry here again
    conn_pipeline, telemetry_pipeline = Base.ARGS[1:2]
    vscodeserver.serve(conn_pipeline; is_dev = "DEBUG_MODE" in Base.ARGS)
end
