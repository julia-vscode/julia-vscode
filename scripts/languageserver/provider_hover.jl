abstract hover <:Method

type Hover
    contents::Vector{String}
    function Hover(tdpp::TextDocumentPositionParams)
        return new(docs(tdpp))
    end
end

function Respond(r::Request{hover,TextDocumentPositionParams})
    try
        return Response{hover,Hover}("2.0",r.id,Hover(r.params))
    catch err
        return Response{hover,Exception}("2.0",r.id,err)
    end
end



