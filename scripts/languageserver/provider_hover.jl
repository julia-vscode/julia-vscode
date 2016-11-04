abstract hover <:Method

type Hover
    contents::String
    function Hover(tdpp::TextDocumentPositionParams)
            x = getSym(tdpp)
            d = string(Docs.doc(x))
            if d[1:16]=="No documentation"
                if isa(x,Function)
                    d = "Function"
                else
                    d = string(typeof(x))
                end
            end
            d = d=="Void" ? "" : d
        return new(d)
    end
end

function Respond(r::Request{hover,TextDocumentPositionParams})
    try
        return Response{hover,Hover}("2.0",r.id,Hover(r.params))
    catch err
        return Response{hover,Exception}("2.0",r.id,err)
    end
end



