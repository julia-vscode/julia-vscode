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


    VSCodeTestServer.serve(ARGS[1], ARGS[2], ARGS[3][3:end], ARGS[4][3:end], ARGS[5][3:end])

catch err
    global_err_handler(err, catch_backtrace(), Base.ARGS[6], "Test Server")
end
