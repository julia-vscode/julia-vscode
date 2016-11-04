function process(r::Request{Val{Symbol("textDocument/signatureHelp")},TextDocumentPositionParams}, server)
    tdpp = r.params

    word = Word(tdpp, server.documents,-1)
    x = getSym(word) 
    M = methods(x).ms

    sigs = map(M) do m
        ptype = string.(collect(m.sig.parameters[2:end]))
        if VERSION > v"0.5"
            pname = string.(m.source.slotnames[2:end])[1:length(ptype)]
            pname = [n=="#unused#" ? "": n for n in pname]
        else
            # TODO Extract parameter name on julia 0.5 here
            pname = fill("unknown", length(ptype))
        end
        p_sigs = map(zip(pname,ptype)) do i
            "$(i[1])::$(i[2])"
        end
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
