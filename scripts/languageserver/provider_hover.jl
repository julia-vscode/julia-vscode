type Hover
    contents::Vector{String}
    function Hover(tdpp::TextDocumentPositionParams, documents)
        return new(docs(tdpp, documents))
    end
end

function process(r::Request{Val{Symbol("textDocument/hover")},TextDocumentPositionParams}, server)
    response = Response(get(r.id),Hover(r.params, server.documents))
    send(response, server)
end

function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/hover")}}, params)
    return TextDocumentPositionParams(params)
end
