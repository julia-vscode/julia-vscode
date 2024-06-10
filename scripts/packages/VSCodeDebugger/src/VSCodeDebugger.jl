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
    client_pipename = ARGS[1]
    server_pipename = ARGS[2]
    error_pipename = ARGS[3]
    try
        # Start a socket server and listen
        server = Sockets.listen(server_pipename)

        # Notify the client that we are ready to accept a connection
        client_socket = Sockets.connect(client_pipename)
        println(client_socket, server_pipename)
        close(client_socket)

        session = Sockets.accept(server)
        try
            DebugAdapter.startdebug(session, (err, bt)->global_err_handler(err, bt, error_pipename, "Debugger"))
        finally
            close(session)
        end
    catch err
        global_err_handler(err, catch_backtrace(), error_pipename, "Debugger")
    end
end

end
