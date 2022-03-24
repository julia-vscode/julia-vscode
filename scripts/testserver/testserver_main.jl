pushfirst!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
using VSCodeTestServer
popfirst!(LOAD_PATH)

include("../error_handler.jl")

import Sockets

try
    conn = Sockets.connect(ARGS[1])

    @debug "Now running"

    VSCodeTestServer.serve(conn)

catch err
    global_err_handler(err, catch_backtrace(), Base.ARGS[2], "Test Server")
end
