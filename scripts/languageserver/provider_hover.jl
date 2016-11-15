function process(r::Request{Val{Symbol("textDocument/hover")},TextDocumentPositionParams}, server)
    # documentation = get_docs(r.params, server)
         
    # response = Response(get(r.id),Hover(documentation))
    documentation = String[]
    sym = Symbol(get_word(r.params, server))
    for b in server.documents[r.params.textDocument.uri].blocks
        if in(r.params.position,b.range)
            push!(documentation, "($(b.range.start.line),$(b.range.start.character)) - ($(b.range.end.line),$(b.range.end.character))")
        elseif b.range.start > r.params.position
            break
        end
    end
    response = Response(get(r.id),Hover(documentation))
    send(response, server)
end

function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/hover")}}, params)
    return TextDocumentPositionParams(params)
end
