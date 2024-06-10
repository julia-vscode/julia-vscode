module VSCodeDebugger

import Sockets

include("../../../error_handler.jl")

include("../../CodeTracking/src/CodeTracking.jl")
include("../../JSON/src/JSON.jl")

module JuliaInterpreter
    using ..CodeTracking

    @static if VERSION >= v"1.6.0"
        include("../../JuliaInterpreter/src/packagedef.jl")
    else
        include("../../../packages-old/JuliaInterpreter/src/packagedef.jl")
    end
end

module DebugAdapter
    import Pkg
    import ..JuliaInterpreter
    import ..JSON

    include("../../DebugAdapter/src/packagedef.jl")
end

function startdebugger()
    try
        # Start a socket server and listen
        server = Sockets.listen(ARGS[2])

        # Notify the client that we are ready to accept a connection
        client_socket = Sockets.connect(ARGS[1])
        println(client_socket, ARGS[2])
        close(client_socket)

        session = Sockets.accept(server)
        try
            DebugAdapter.startdebug(session, (err, bt)->global_err_handler(err, bt, ARGS[3], "Debugger"))
        finally
            close(session)
        end
    catch err
        global_err_handler(err, catch_backtrace(), ARGS[3], "Debugger")
    end
end

end
