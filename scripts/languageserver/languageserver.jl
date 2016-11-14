type Document
    data::Vector{UInt8}
    blocks::Vector{Any}
end

type LanguageServer
    pipe_in
    pipe_out

    rootPath::String 
    documents::Dict{String,Document}
    DocStore::Dict{String,Any}

    function LanguageServer(pipe_in,pipe_out)
        new(pipe_in,pipe_out,"",Dict{String,Document}(),Dict{String,Any}())
    end
end

function send(message, server)
    message_json = JSON.json(message)

    write_transport_layer(server.pipe_out,message_json)
end

function Base.run(server::LanguageServer)
    while true
        message = read_transport_layer(server.pipe_in)
        request = parse(Request, message)

        process(request, server)
    end
end
