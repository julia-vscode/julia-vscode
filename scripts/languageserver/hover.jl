abstract hover <:Method

type Hover
    contents::String
end

function Respond(r::Request{hover,TextDocumentPositionParams})
    try
        x = getSym(r.params)
        d = string(Docs.doc(x))
        if d[1:16]=="No documentation"
            if isa(x,Function)
                d = "Function"
            else
                d = string(typeof(x))
            end
        end
        
        d = d=="Void" ? "" : d
        return Response{hover,Hover}("2.0",r.id,Hover(d))
    catch err
        return Response{hover,Exception}("2.0",r.id,err)
    end
end



