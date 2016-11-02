conn = STDOUT
(outRead, outWrite) = redirect_stdout()

if VERSION < v"0.5"
    error("VS Code julia language server only works with julia 0.5 or newer.")
end

include("dependencies.jl")
use_and_install_dependencies(["Compat", "JSON", "Lint", "URIParser","JuliaParser"])

if length(Base.ARGS)==1
    push!(LOAD_PATH, Base.ARGS[1])
elseif length(Base.ARGS)>1
    error("Invalid number of arguments passed to julia language server.")
end


include("protocol.jl")
include("misc.jl")
include("hover.jl")
include("completions.jl")
include("definitions.jl")
include("signatures.jl")
include("transport.jl")
include("messages.jl")
include("lint.jl")

documents = Dict{String,Array{String,1}}()
while true
    message = read_transport_layer(STDIN)
    message_json = JSON.parse(message)

    response = nothing
    #if message_json["method"]=="initialize"
    #    response = process_message_initialize(message_json)
    if message_json["method"]=="textDocument/didOpen"
        response = process_message_textDocument_didOpen(message_json)
    elseif message_json["method"]=="textDocument/didChange"
        process_message_textDocument_didChange(message_json)
    elseif message_json["method"]=="textDocument/didClose"
        process_message_textDocument_didClose(message_json)
    elseif message_json["method"]=="textDocument/didSave"
        nothing
    elseif in(message_json["method"],ProviderList)
        req  = Request(message_json)
        resp = Respond(req)
        response = JSON.json(resp)
    elseif message_json["method"]=="\$/cancelRequest"
        #either do nothing or do something to stop long running response functions.
    else
        error("Unknown message $(message_json["method"])")
    end

    if response!=nothing
        write_transport_layer(conn,response)
    end
end
