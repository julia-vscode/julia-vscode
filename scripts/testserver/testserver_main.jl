@info "Starting the Julia Test Server"

pushfirst!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
try
    using VSCodeTestServer
finally
    popfirst!(LOAD_PATH)
end

include("../error_handler.jl")

import Sockets

try
    conn = Sockets.connect(ARGS[1])

    VSCodeTestServer.serve(conn, ARGS[2][3:end], ARGS[3][3:end], ARGS[4][3:end])

catch err
    global_err_handler(err, catch_backtrace(), Base.ARGS[5], "Test Server")
end
