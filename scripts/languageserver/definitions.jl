abstract definition <:Method

function Location(tdpp::TextDocumentPositionParams)
    x = getSym(tdpp)
    return map(m->Location(functionloc(m)...),methods(x).ms)
end

function Respond(r::Request{definition,TextDocumentPositionParams})
    try
        return Response{definition,Vector{Location}}("2.0",r.id,Location(r.params))
    catch err
        return Response{definition,Exception}("2.0",r.id,err)
    end
end

