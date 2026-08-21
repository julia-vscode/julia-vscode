module VSCodeDebugger

import Sockets

include("../../../error_handler.jl")
include("../../../include_with_private_deps.jl")

module CodeTracking end
include_with_private_deps(CodeTracking, "../../CodeTracking/src/CodeTracking.jl")

module JSON end
include_with_private_deps(JSON, "../../JSON/src/JSON.jl")

module JuliaInterpreter end
@static if VERSION >= v"1.10.0"
    include_with_private_deps(JuliaInterpreter, "../../JuliaInterpreter/src/JuliaInterpreter.jl")
elseif VERSION >= v"1.6.0"
    include_with_private_deps(JuliaInterpreter, "../../../packages-old/v1.9/JuliaInterpreter/src/JuliaInterpreter.jl")
else
    include_with_private_deps(JuliaInterpreter, "../../../packages-old/v1.5/JuliaInterpreter/src/JuliaInterpreter.jl")
end

module DebugAdapter end
include_with_private_deps(DebugAdapter, "../../DebugAdapter/src/DebugAdapter.jl")

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

        conn = Sockets.accept(server)
        try
            debugsession = DebugAdapter.DebugSession(conn)

            run(debugsession, (err, bt)->global_err_handler(err, bt, error_pipename, "Debugger"))
        finally
            close(conn)
        end
    catch err
        global_err_handler(err, catch_backtrace(), error_pipename, "Debugger")
    end
end

end
