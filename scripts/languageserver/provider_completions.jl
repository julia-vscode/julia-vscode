abstract completion <:Method

type CompletionItem
    label::String
    kind::Int
    documentation::String
    function CompletionItem(str::String)
        s = getSym(str)
        d = ""
        try 
            d = join(docs(s)[2:end],'\n')
        end
        kind = 6
        if isa(s,String)
            kind = 1
        elseif isa(s,Function)
            kind = 3
        elseif isa(s,DataType)
            kind = 7
        elseif isa(s,Module)
            kind = 9
        elseif isa(s,Number)
            kind = 12
        elseif isa(s,Enum)
            kind = 13
        end
        new(str,kind,d)
    end
end

type CompletionList
    isIncomplete::Bool
    items::Vector{CompletionItem}
    function CompletionList(tdpp::TextDocumentPositionParams)
        line = Line(tdpp)
        comp = Base.REPLCompletions.completions(line,tdpp.position.character)[1]
        n = length(comp)
        comp = comp[1:min(length(comp),25)]
        CIs = CompletionItem.(comp)
        return new(25<n,CIs)
    end
end

function Respond(r::Request{completion,TextDocumentPositionParams})
    try
        return Response{completion,CompletionList}("2.0",r.id,CompletionList(r.params))
    catch err
        return Response{completion,Exception}(r.id,err)
    end
end
