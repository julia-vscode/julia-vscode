abstract completion <:Method

type CompletionItem
    label::String
    kind::Int
end
function CompletionItem(str::String)
    s = getSym(str)
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
    CompletionItem(str,kind)
end

type CompletionList
    isIncomplete::Bool
    items::Vector{CompletionItem}
end

function Respond(r::Request{completion,TextDocumentPositionParams})
    line = Line(r.params)
    try
        comp = Base.REPLCompletions.completions(line,r.params.position.character)[1]
        n = length(comp)
        comp = comp[1:min(length(comp),10)]

        CIs = CompletionItem.(comp)
        CL = CompletionList(10<n,CIs)
        return Response{completion,CompletionList}("2.0",r.id,CL)
    catch err
        return Response{completion,Exception}(r.id,err)
    end
end
