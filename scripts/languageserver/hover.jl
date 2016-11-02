abstract hover <:Method

type Hover
    contents::String
end

function Respond(r::Request{hover,TextDocumentPositionParams})
    try
        x = getSym(r.params)
        d = string(Docs.doc(x))        
        d = d[1:16]=="No documentation" ? string(typeof(x)) : d
        d = d=="Void" ? "" : d
        if length(d)>1000
            n,lr = first20lines(d)
            d = d[lr]*"\n\nDocumentation too long, only showing first 20 lines."
        end
        return Response{hover,Hover}("2.0",r.id,Hover(d))
    catch err
        return Response{hover,Exception}("2.0",r.id,err)
    end
end



