using Test
import Sockets
import VSCodeDebugger

@testset "VSCodeDebugger" begin
    @testset "listen_for_client" begin
        # The extension proposes the socket name, but binding it here can fail for
        # reasons that are not about the name being wrong: on macOS this process and
        # the extension host get different temp directories, a sandbox or an ACL can
        # refuse the one we were handed, and a socket path has a length limit. The
        # handshake tells the extension which name was bound, so falling back to one
        # of our own keeps the debugger working instead of filing a crash report.
        proposed = VSCodeDebugger.fallback_server_pipename()

        # Ordinary case: the proposed name binds, and it is the name reported.
        name, server = VSCodeDebugger.listen_for_client(proposed)
        @test name == proposed
        close(server)

        # A name that cannot be bound: report one that can, and make sure it is a
        # socket something else can actually attach to.
        taken = VSCodeDebugger.fallback_server_pipename()
        held = Sockets.listen(taken)
        try
            name, server = VSCodeDebugger.listen_for_client(taken)
            @test name != taken
            client = Sockets.connect(name)
            @test isopen(client)
            close(client)
            close(server)
        finally
            close(held)
        end

        # Anything that is not a failure to bind still propagates.
        @test_throws MethodError VSCodeDebugger.listen_for_client(:not_a_name)
    end
end
