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

end  # module
