println(Base.stderr, "Starting notebook kernel server")

# load_vscodeserver.jl loads the package named here along with VSCodeServer. `eval`, because Julia
# before 1.3 has no `var"…"` syntax for the name, whose `#` hides it from the workspace view.
Core.eval(Main, :(const $(Symbol("#vscode_extra_package")) = :VSCodeNotebookServer))
include("../terminalserver/load_vscodeserver.jl")

using InteractiveUtils

let
    outputchannel_logger = Base.CoreLogging.SimpleLogger(Base.stderr)

    Base.with_logger(outputchannel_logger) do
        @info "Processing command line arguments..."
    end

    args = [popfirst!(Base.ARGS) for _ in 1:3]

    conn_pipename, debugger_pipename, telemetry_pipename = args[1:3]

    Base.with_logger(outputchannel_logger) do
        @info "Command line arguments processed"
    end

    ccall(:jl_exit_on_sigint, Nothing, (Cint,), false)

    Base.with_logger(outputchannel_logger) do
        @info "Handing things off to VSCodeNotebookServer.serve_notebook"
    end

    VSCodeNotebookServer.serve_notebook(conn_pipename, debugger_pipename, outputchannel_logger, error_handler=(err,bt) -> global_err_handler(err, bt, telemetry_pipename, "Notebook"))
end
