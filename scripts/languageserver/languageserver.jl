conn = STDOUT
(outRead, outWrite) = redirect_stdout()

if VERSION < v"0.5"
    error("VS Code julia language server only works with julia 0.5 or newer.")
end

include("dependencies.jl")
#use_and_install_dependencies(["Compat", "JSON", "Lint", "URIParser","JuliaParser"])
using Compat,JSON,Lint,URIParser,JuliaParser

if length(Base.ARGS)==1
    push!(LOAD_PATH, Base.ARGS[1])
elseif length(Base.ARGS)>1
    error("Invalid number of arguments passed to julia language server.")
end


include("protocol.jl")
include("diagnostics.jl")
include("misc.jl")
include("hover.jl")
include("completions.jl")
include("definitions.jl")
include("signatures.jl")
include("transport.jl")
include("messages.jl")

documents = Dict{String,Array{String,1}}()
while true
    message = read_transport_layer(STDIN)
    message_json = JSON.parse(message)

    response = nothing
    if message_json["method"]=="textDocument/didSave"
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

    if !(response==nothing || response=="null")
        write_transport_layer(conn,response)
    end
end
