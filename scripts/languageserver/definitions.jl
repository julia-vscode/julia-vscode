abstract definition <:Method


function Respond(r::Request{definition,TextDocumentPositionParams})
    try
        x = getSym(r.params)    
        locs = map(m->Location(functionloc(m)...),methods(x).ms)
        locs = locs[1:min(5,length(locs))]
        return Response{definition,Vector{Location}}("2.0",r.id,locs)
    catch err
        return Response{definition,Exception}("2.0",r.id,err)
    end
end


