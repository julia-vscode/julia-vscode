"""
The notebook kernel server of the Julia extension for VS Code.

It is a package of its own, because it includes IJuliaCore, whose IO type adds methods to
`Base.in` and similar functions. In a REPL, those methods would invalidate compiled code of
the REPL and of other packages, so only notebook processes load this package.
"""
module VSCodeNotebookServer

using REPL, Sockets
import Base: display
import VSCodeServer
import VSCodeServer: JSON, JSONRPC, DebugAdapter, DEBUG_SESSION, conn_endpoint, crop_backtrace,
    ends_with_semicolon, revise, start_debug_backend, withpath,
    repl_getvariables_request_type, repl_getvariables_request,
    repl_getlazy_request_type, repl_getlazy_request,
    repl_showingrid_notification_type, repl_showingrid_notification,
    repl_gettabledata_request_type, get_table_data_request,
    repl_clearlazytable_notification_type, clear_lazy_table_notification

module IJuliaCore
using ..JSON
using Printf
import Base64

include("../../IJuliaCore/src/packagedef.jl")
end

include("notebookdisplay.jl")
include("serve_notebook.jl")

"""
    precompile_display()

Display a few typical cell results on the notebook display, send the result of a cell, print to an
output stream and log a message, all through a stand-in for the connection.

`conn_endpoint[]` is `nothing` again afterwards.
"""
function precompile_display()
    in_pipe = Pipe()
    out_pipe = Pipe()
    Base.link_pipe!(in_pipe)
    Base.link_pipe!(out_pipe)
    reader_task = @async while isopen(out_pipe.out)
        readavailable(out_pipe.out)
    end
    endpoint = JSONRPC.JSONRPCEndpoint(in_pipe.out, out_pipe.in)
    JSONRPC.start(endpoint)
    conn_endpoint[] = endpoint
    try
        notebook_display = JuliaNotebookInlineDisplay()
        for x in (1, 1.5, "text", [1.0, 2.0, 3.0], [1.0 2.0; 3.0 4.0])
            display(notebook_display, x)
        end
        result = (success = true, error = (message = "", name = "", stack = ""))
        JSONRPC.send_success_response(endpoint, JSONRPC.Request(notebook_runcell_request_type.method, nothing, 1, nothing), result)
        io_send_callback("stdout", "text")
        stdio = IJuliaCore.IJuliaStdio(out_pipe.in, io_send_callback, "stdout")
        print(stdio, "text", "\n")
        # The extension starts the kernel with `--color=yes`, which makes `stderr` an `IOContext`.
        log_progress(Base.CoreLogging.SimpleLogger(IOContext(out_pipe.in, :color => true)), "text")
    finally
        conn_endpoint[] = nothing
        close(endpoint)
        close(in_pipe.in)
        close(out_pipe.out)
        wait(reader_task)
    end
    return typeof(endpoint)
end

function precompile_workload()
    E = precompile_display()

    # `serve_notebook` redirects stdio and does not return, and the cell handler evaluates code
    # into `Main`, which precompilation does not allow. So these get directives only.
    precompile(start_notebook_kernel!, (Vector{String},))
    precompile(notebook_runcell_request, (E, NotebookRunCellArguments, JSONRPC.CancellationTokens.CancellationToken))
    precompile(NotebookRunCellArguments, (Dict{String,Any},))
    @static if VERSION >= v"1.5"
        precompile(include_string, (typeof(REPL.softscope), Module, String, String))
    end

    # Redirecting, watching and flushing the streams would act on the streams of the precompiling
    # process and fill the global stream buffers, so these get directives too.
    S = IJuliaCore.IJuliaStdio{Base.PipeEndpoint,typeof(io_send_callback)}
    precompile(redirect_stdout, (S,))
    precompile(flush, (S,))
    precompile(IJuliaCore.watch_stream, (Base.PipeEndpoint, String, typeof(io_send_callback)))
    precompile(IJuliaCore.send_stdio, (String, typeof(io_send_callback)))

    # The methods that this package adds for its display and stream types invalidate code
    # that VSCodeServer and Base compiled in advance.
    precompile(VSCodeServer.run_debug_backend, (String, Any))
    precompile(display, (Any,))
end

function _precompile_()
    ccall(:jl_generating_output, Cint, ()) == 1 || return nothing

    # Save everything that the workload infers, including Base methods that it calls by
    # runtime dispatch, as PrecompileTools does on Julia 1.12 and later.
    @static if VERSION >= v"1.12"
        ccall(:jl_tag_newly_inferred_enable, Cvoid, ())
    end
    try
        precompile_workload()
    finally
        @static if VERSION >= v"1.12"
            ccall(:jl_tag_newly_inferred_disable, Cvoid, ())
        end
    end
end

_precompile_()

end  # module
