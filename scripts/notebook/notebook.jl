Base.push!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
using VSCodeNotebookServer
pop!(LOAD_PATH)

let
    conn_pipeline = Base.ARGS[1]
    VSCodeNotebookServer.serve(conn_pipeline)
end
