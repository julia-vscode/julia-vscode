function process(r::Request{Val{Symbol("textDocument/completion")},TextDocumentPositionParams}, server)
    tdpp = r.params
    line = get_line(tdpp, server)
    comp = Base.REPLCompletions.completions(line,tdpp.position.character)[1]
    n = length(comp)
    comp = comp[1:min(length(comp),25)]
    CIs = map(comp) do i
        s = get_sym(i)
        d = ""
        try 
            d = join(get_docs(s)[2:end],'\n')
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
        CompletionItem(i,kind,d)
    end

    completion_list = CompletionList(25<n,CIs)

    response =  Response(get(r.id),completion_list)
    send(response, server)
end

function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/completion")}}, params)
    return TextDocumentPositionParams(params)
end
