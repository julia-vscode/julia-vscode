function process(r::Request{Val{Symbol("textDocument/documentSymbol")},TextDocumentIdentifier}, server)
    doc = join(server.documents[r.params.uri],'\n')
    
    docsyms = SymbolInformation[]

    i0 = 1
    while i0<=length(doc)
        (ex,i1) = parse(doc,i0)
        try
            assignsdocs(ex) && (ex = ex.args[3])
            in(ex.head,[:const,:global,:local]) && (ex = ex.args[1])
            rng=Range(Position(chartopos(doc,i0)...),Position(chartopos(doc,i1)...))
            if ex.head==:(=) && isa(ex.args[1],Symbol)
                push!(docsyms,SymbolInformation(string(ex.args[1]),13,Location(r.params.uri,rng)))
            elseif (ex.head==:(=) && isa(ex.args[1],Expr) && ex.args[1].head==:call) || ex.head == :function 
                push!(docsyms,SymbolInformation(string(ex.args[1].args[1]),12,Location(r.params.uri,rng)))
            elseif in(ex.head,[:immutable,:type])
                n = isa(ex.args[2],Symbol) ? ex.args[2] : ex.args[2].args[1]
                push!(docsyms,SymbolInformation(string(n),5,Location(r.params.uri,rng)))
            end
        end
        i0=i1
    end
    
    response = Response(get(r.id),docsyms)
    send(response, server)
end

function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/documentSymbol")}}, params)
    return TextDocumentIdentifier(params["textDocument"])
end

doc = readstring("/home/zac/github/julia-master/base/float.jl")
assignsdocs(ex::Expr) = ex.head==:macrocall && ex.args[1]==GlobalRef(Core,Symbol("@doc"))


function chartopos(doc::AbstractString,N::Int)
    io = IOBuffer(doc)
    dn =length(doc)
    ln,cn,i = 1,0,0
    while i < N && i<dn
        i+=1
        cn+=1
        if read(io,Char)=='\n'
            ln+=1
            cn=0
        end
    end
    return ln,cn
end