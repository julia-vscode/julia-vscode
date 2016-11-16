function process(r::Request{Val{Symbol("textDocument/hover")},TextDocumentPositionParams}, server)
    word = get_word(r.params, server)
    sword = split(word,'.')
    if length(sword)>1
        documentation = [MarkedString(get_type(sword, r.params, server))]
    else
        documentation = get_docs(r.params, server)
    end
         
    response = Response(get(r.id),Hover(documentation))
    send(response, server)
end

function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/hover")}}, params)
    return TextDocumentPositionParams(params)
end
