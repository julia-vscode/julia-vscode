function process(r::Request{Val{Symbol("textDocument/definition")},TextDocumentPositionParams}, server)
    x = getSym(r.params, server.documents)

    locations = map(methods(x).ms) do m
        (filename, line) = functionloc(m)
        filename = "file:$filename"
        return Location(filename, line-1)
    end

    response = Response(get(r.id),locations)
    send(response, server)
end

function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/definition")}}, params)
    return TextDocumentPositionParams(params)
end
