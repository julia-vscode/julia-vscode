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
    function CompletionList(tdpp::TextDocumentPositionParams, documents)
        line = Line(tdpp, documents)
        comp = Base.REPLCompletions.completions(line,tdpp.position.character)[1]
        n = length(comp)
        comp = comp[1:min(length(comp),25)]
        CIs = CompletionItem.(comp)
        return new(25<n,CIs)
    end
end

function process(r::Request{Val{Symbol("textDocument/completion")},TextDocumentPositionParams}, server)
    response =  Response(get(r.id),CompletionList(r.params, server.documents))
    send(response, server)
end

function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/completion")}}, params)
    return TextDocumentPositionParams(params)
end
