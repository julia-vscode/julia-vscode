module VSCodeDebugger

import Sockets

include("../../../error_handler.jl")

include("../../CodeTracking/src/CodeTracking.jl")
include("../../JSON/src/JSON.jl")

module JuliaInterpreter
    using ..CodeTracking

    include("../../JuliaInterpreter/src/packagedef.jl")
end

module JSONRPC
    import ..JSON
    import UUIDs

    include("../../JSONRPC/src/packagedef.jl")
end

module DebugAdapter
    import ..JuliaInterpreter
    import ..JSON
    import ..JSONRPC
    import ..JSONRPC: @dict_readable, Outbound

    include("../../DebugAdapter/src/packagedef.jl")
end

function startdebugger()
    pipenames = DebugAdapter.clean_up_ARGS_in_launch_mode()
    try
        @debug "Trying to connect to debug adapter."
        socket = Sockets.connect(pipenames[1])
        try
            DebugAdapter.startdebug(socket, (err, bt)->global_err_handler(err, bt, pipenames[2], "Debugger"))
        finally
            close(socket)
        end
    catch err
        global_err_handler(err, catch_backtrace(), pipenames[2], "Debugger")
    end
end

end
