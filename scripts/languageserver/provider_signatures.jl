function process(r::Request{Val{Symbol("textDocument/signatureHelp")},TextDocumentPositionParams}, server)
    tdpp = r.params

    word = get_word(tdpp, server,-1)
    x = get_sym(word) 
    M = methods(x).ms

    sigs = map(M) do m
        tv, decls, file, line = Base.arg_decl_parts(m)
        p_sigs = [isempty(i[2]) ? i[1] : i[1]*"::"*i[2] for i in decls[2:end]]
        desc = string(string(m.name), "(",join(p_sigs, ", "),")")

        PI = map(ParameterInformation,p_sigs)
        # Extract documentation here
        doc = ""
        return SignatureInformation(desc,doc,PI)
    end
    
    # TODO pass in the correct argument position
    signatureHelper = SignatureHelp(sigs,0,0)

    response = Response(get(r.id),signatureHelper)
    send(response,server)
end

function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/signatureHelp")}}, params)
    return TextDocumentPositionParams(params)
end
