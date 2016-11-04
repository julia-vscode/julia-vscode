function Location(tdpp::TextDocumentPositionParams, documents)
    x = getSym(tdpp, documents)
    return map(m-> begin
            (filename, line) = functionloc(m)
            filename = "file:$filename"
            Location(filename, line-1)
        end,methods(x).ms)
end

function process(r::Request{Val{Symbol("textDocument/definition")},TextDocumentPositionParams}, server)
    response = Response(get(r.id),Location(r.params, server.documents))
    send(response, server)
end

function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/definition")}}, params)
    return TextDocumentPositionParams(params)
end
