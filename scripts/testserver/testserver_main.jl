pushfirst!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
using VSCodeTestServer
popfirst!(LOAD_PATH)

include("../error_handler.jl")

import Sockets

try
    conn = Sockets.connect(ARGS[1])

    @debug "Now running"

    VSCodeTestServer.serve(conn, ARGS[2])

catch err
    global_err_handler(err, catch_backtrace(), Base.ARGS[3], "Test Server")
end
