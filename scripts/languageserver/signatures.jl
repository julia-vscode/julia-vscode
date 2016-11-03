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
        ptype = string.(collect(m.sig.parameters[2:end]))
        pname = string.(m.source.slotnames[2:end])[1:length(ptype)]
        pname = [n=="#unused#" ? "": n for n in pname]
        desc = string(m.name)*"("*mapreduce(x->"$(x[1])::$(x[2]), ",*,"",zip(pname,ptype))[1:end-2]*")"
        
        PI    = map(ParameterInformation,pname,ptype)   
        return new(desc,"",PI)
    end
end

type SignatureHelp
    signatures::Vector{SignatureInformation}
    activeSignature::Int
    activeParameter::Int
    SignatureHelp(sigs::Vector{SignatureInformation}) = new(sigs,0,0)
end

function Respond(r::Request{signature,TextDocumentPositionParams})
    try
        word = Word(r.params,-1)
        x = getSym(word) 
        M = methods(x).ms
        sigs = SignatureInformation[]
        cnt = 0
        while cnt<=length(M)
            cnt+=1 
            try
                s = SignatureInformation(M[cnt])
                push!(sigs,s)
            end
        end
        SH = SignatureHelp(sigs)        
        return Response{signature,SignatureHelp}("2.0",r.id,SH)
    catch err
        return Response{signature,Exception}("2.0",r.id,err)
    end
end

function Base.length(s::SignatureInformation)
    n = length(s.label)+30
    for p in s.parameters
        n+=length(p.documentation)+length(p.label)+40
    end
    n
end
