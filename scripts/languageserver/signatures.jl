abstract signature <:Method

type ParameterInformation
    label::String
    documentation::String
end

type SignatureInformation
    label::String
    documentation::String
    parameters::Vector{ParameterInformation}
    function SignatureInformation(m::Base.Method)
        pname = string.(m.source.slotnames[2:end])
        ptype = string.(collect(m.sig.parameters[2:end]))
        PI    = map(ParameterInformation,pname,ptype)   
        return new(string(m.name),"",PI)
    end
end


type SignatureHelp
    signatures::Vector{SignatureInformation}
    activeSignature::Int
    activeParameter::Int
    SignatureHelp(sigs::Vector{SignatureInformation}) = new(sigs,0,0)
end

function Respond(r::Request{signature,TextDocumentPositionParams})
    word = Word(r.params,-1)
    x = getSym(word) 
    try
        M = methods(x).ms
        sigs = SignatureInformation[]
        for m in M
            try
                s = SignatureInformation(m)
                push!(sigs,s)
            end
        end
        SH = SignatureHelp(sigs[1:min(3,length(sigs))])
        
        return Response{signature,SignatureHelp}("2.0",r.id,SH)
    catch err
        return Response{signature,Exception}(r.id,err)
    end
end



