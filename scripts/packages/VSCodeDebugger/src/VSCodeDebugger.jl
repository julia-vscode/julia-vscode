module VSCodeDebugger

import Sockets

include("../../../error_handler.jl")

include("../../CodeTracking/src/CodeTracking.jl")
include("../../JSON/src/JSON.jl")

module JuliaInterpreter
    using ..CodeTracking

    @static if VERSION >= v"1.10.0"
        include("../../JuliaInterpreter/src/packagedef.jl")
    elseif VERSION >= v"1.6.0"
        include("../../../packages-old/v1.9/JuliaInterpreter/src/packagedef.jl")
    else
        include("../../../packages-old/v1.5/JuliaInterpreter/src/packagedef.jl")
    end
end

module DebugAdapter
    import Pkg
    import ..JuliaInterpreter
    import ..JSON

    include("../../DebugAdapter/src/packagedef.jl")
end

"""
A socket name this process is sure it can create, for when the one the
extension proposed cannot be bound here.

Deliberately built from this process's own temp directory: that is the thing
that differs from the extension's. On Windows a pipe name is not a filesystem
path at all, so it is composed directly.
"""
function fallback_server_pipename()
    if Sys.iswindows()
        return string("\\\\.\\pipe\\vsc-jl-dbg-", getpid(), "-", string(rand(UInt64), base = 16))
    else
        return tempname()
    end
end

"""
Bind the socket the extension will attach to, and answer the name that was
actually bound.

The extension proposes a name, but binding it here can fail for reasons that
have nothing to do with the name being wrong: on macOS the extension host and
this process are given different temp directories, a sandbox or an ACL can
refuse the one we were handed, and a socket path has a hard length limit that
the proposed one can exceed. Telemetry has
`ArgumentError: could not listen on path /var/folders/.../vsc-jl-dbg-<uuid>`
for every debug session one user started.

Nothing about the handshake requires the extension's name to be the one used:
it is sent back on the ready connection below, and the extension attaches to
whatever it is told. So a name of this process's own is just as good an answer,
and this only gives up -- into the crash handler, unmasked -- when a socket of
our own choosing cannot be created either, which is no longer a difference of
opinion about a path but a machine that cannot do sockets, or a bug here.
"""
function listen_for_client(server_pipename)
    try
        return server_pipename, Sockets.listen(server_pipename)
    catch err
        # `listen` reports a refused bind as an `ArgumentError` naming the path,
        # and the underlying failure as an `IOError`.
        err isa ArgumentError || err isa Base.IOError || rethrow()
        fallback = fallback_server_pipename()
        @debug "Could not listen on the socket the extension proposed, using our own." server_pipename fallback exception = (err, catch_backtrace())
        return fallback, Sockets.listen(fallback)
    end
end

function startdebugger()
    client_pipename = ARGS[1]
    server_pipename = ARGS[2]
    error_pipename = ARGS[3]
    try
        # Start a socket server and listen
        server_pipename, server = listen_for_client(server_pipename)

        # Notify the client that we are ready to accept a connection, and tell it
        # which socket to attach to -- which is not always the one it proposed.
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
