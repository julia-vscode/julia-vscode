function process(r::Request{Val{Symbol("textDocument/hover")},TextDocumentPositionParams}, server)
    documentation = get_docs(r.params, server)

    response = Response(get(r.id),Hover(documentation))
    send(response, server)
end

function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/hover")}}, params)
    return TextDocumentPositionParams(params)
end
