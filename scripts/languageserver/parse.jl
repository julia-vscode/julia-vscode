# Meta info on a symbol available either in the Main namespace or 
# locally (i.e. in a function, type definition)
type VarInfo
    t::Any # indicator of variable type
    doc::String
end

# A block of sequential ASTs corresponding to ranges in the source
# file including leading whitspace. May contain informtion on local 
# variables where possible.
type Block
    uptodate::Bool
    ex::Any
    range::Range
    name::String
    var::VarInfo
    localvar::Dict{String,VarInfo}
    diags::Vector{Diagnostic}
end

function Block(utd, ex, r::Range)
    t, name, doc, lvars = classify_expr(ex)
    ctx = LintContext()
    ctx.lineabs = r.start.line+1
    dl = r.stop.line-r.start.line-ctx.line
    # Lint.lintexpr(ex, ctx)
    # diags = map(ctx.messages) do l
    #     return Diagnostic(Range(Position(r.start.line+l.line+dl-1, 0), Position(r.start.line+l.line+dl-1, 100)),
    #                     LintSeverity[string(l.code)[1]],
    #                     string(l.code),
    #                     "Lint.jl",
    #                     l.message) 
    # end
    diags = Diagnostic[]
    v = VarInfo(t, doc)

    return Block(utd, ex, r, name,v, lvars, diags)
end

function parseblocks(uri::String, server::LanguageServer, updateall=false)
    doc = String(server.documents[uri].data)
    blocks = server.documents[uri].blocks
    linebreaks = get_linebreaks(doc) 
    n = length(doc.data)
    if doc==""
        server.documents[uri].blocks = []
        return
    end
    ifirstbad = findfirst(b->!b.uptodate, blocks)

    # Check which region of the source file to parse:

    # Parse the whole file if it's not been parsed or you're asked to,
    #  the last OR fixes something obscure (find it and fix it)
    if isempty(blocks) || updateall || ifirstbad==0
        i0 = i1 = 1 # Char position in document
        p0 = p1 = Position(0, 0) # vscode Protocul position
        out = Block[]
        inextgood = 0
    else # reparse the source from the first bad block to the next good block
        inextgood = findnext(b->b.uptodate, blocks, ifirstbad) # index of next up to date Block
        p0 = p1 = blocks[ifirstbad].range.start
        i0 = i1 = linebreaks[p0.line+1]+p0.character+1
        out = blocks[1:ifirstbad-1]
    end

    while 0 < i1 ≤ n
        (ex,i1) = parse(doc, i0, raise=false)
        p0 = get_pos(i0, linebreaks)
        p1 = get_pos(i1-1, linebreaks)
        if isa(ex, Expr) && ex.head in[:incomplete,:error]
            push!(out,Block(false, ex, Range(p0, Position(p0.line+1, 0))))
            while true
                !(doc[i0] in ['\n','\t',' ']) && break
                i0 += 1
            end
            i0 = i1 = search(doc,'\n',i0)
        else
            push!(out,Block(true,ex,Range(p0,p1)))
            i0 = i1
            if inextgood>0 && ex==blocks[inextgood].ex
                dl = p0.line - blocks[inextgood].range.start.line
                out = vcat(out,blocks[inextgood+1:end])
                for i  = inextgood+1:length(out)
                    out[i].range.start.line += dl
                    out[i].range.stop.line += dl
                end
                break
            end
        end
    end
    server.documents[uri].blocks = out
    server.documents[uri].blocks[end].range.stop = get_pos(linebreaks[end],linebreaks) #ensure last block fills document
    return 
end 



function classify_expr(ex)
    if isa(ex, Expr)
        if ex.head==:macrocall && ex.args[1]==GlobalRef(Core, Symbol("@doc"))
            return classify_expr(ex.args[3])
        elseif ex.head in [:const, :global]
            return classify_expr(ex.args[1])
        elseif ex.head==:function || (ex.head==:(=) && isa(ex.args[1], Expr) && ex.args[1].head==:call)
            return parsefunction(ex)
        elseif ex.head==:macro
            return "macro", string(ex.args[1].args[1]), "", Dict(string(x)=>VarInfo(Any,"macro argument") for x in ex.args[1].args[2:end])
        elseif ex.head in [:abstract, :bitstype, :type, :immutable]
            return parsedatatype(ex)
        elseif ex.head==:module
            return "Module", string(ex.args[2]), "", Dict()
        elseif ex.head == :(=) && isa(ex.args[1], Symbol)
            return "Any", string(ex.args[1]), "", Dict()
        end
    end
    return "Any", "none", "", Dict()
end

function parsefunction(ex)
    (isa(ex.args[1], Symbol) || isempty(ex.args[1].args)) && return "Function", "none", "", Dict()
    fname = string(isa(ex.args[1].args[1], Symbol) ? ex.args[1].args[1] : ex.args[1].args[1].args[1])
    lvars = Dict()
    for a in ex.args[1].args[2:end]
        if isa(a, Symbol)
            lvars[string(a)] = VarInfo(Any, "Function argument")
        elseif a.head==:(::)
            if length(a.args)>1
                lvars[string(a.args[1])] = VarInfo(a.args[2], "Function argument")
            else
                lvars[string(a.args[1])] = VarInfo(DataType, "Function argument")
            end
        elseif a.head==:kw
            if isa(a.args[1], Symbol)
                lvars[string(a.args[1])] = VarInfo(Any, "Function keyword argument")
            else
                lvars[string(a.args[1].args[1])] = VarInfo(Any,"Function keyword argument")
            end 
        elseif a.head==:parameters
            for sub_a in a.args
                if isa(sub_a, Symbol)
                    lvars[string(sub_a)] = VarInfo(Any, "Function argument")
                elseif sub_a.head==:...
                    lvars[string(sub_a.args[1])] = VarInfo("keywords", "Function Argument")
                elseif sub_a.head==:kw
                    if isa(sub_a.args[1], Symbol)                    
                        lvars[string(sub_a.args[1])] = VarInfo("", "Function Argument")
                    elseif sub_a.args[1].head==:(::)
                        lvars[string(sub_a.args[1].args[1])] = VarInfo(sub_a.args[1].args[2], "Function Argument")
                    end
                end
            end
        end
    end
    for a in ex.args[2].args
        if isa(a,Expr) && a.head==:(=) && isa(a.args[1], Symbol)
            name = string(a.args[1]) 
            if name in keys(lvars)
                lvars[name].doc = "$(lvars[name].doc) (redefined in body)"
                lvars[name].t = "Any"
            else
                lvars[name] = VarInfo("Any", "")
            end
        end
    end

    doc = string(ex.args[1])
    return "Function", fname, doc, lvars
end


function parsedatatype(ex)
    fields = Dict()
    if ex.head==:abstract
        name = string(isa(ex.args[1], Symbol) ? ex.args[1] : ex.args[1].args[1])
        doc = string(ex)
    elseif ex.head==:bitstype
        name = string(isa(ex.args[2], Symbol) ? ex.args[2] : ex.args[2].args[1])
        doc = string(ex)
    else
        name = string(isa(ex.args[2], Symbol) ? ex.args[2] : ex.args[2].args[1])
        st = string(isa(ex.args[2], Symbol) ? "Any" : string(ex.args[2].args[2]))
        for a in ex.args[3].args 
            if isa(a, Symbol)
                fields[string(a)] = VarInfo(Any, "")
            elseif a.head==:(::)
                fields[string(a.args[1])] = VarInfo(length(a.args)==1 ? a.args[1] : a.args[2], "")
            end
        end
        doc = "$name <: $(st)"
        doc *= length(fields)>0 ? "\n"*prod("  $fname::$(v.t)\n" for (fname,v) in fields) : "" 
    end
    return "DataType", name, doc, fields
end

import Base:<, in, intersect
<(a::Position, b::Position) =  a.line<b.line || (a.line≤b.line && a.character<b.character)
function in(p::Position, r::Range)
    (r.start.line < p.line < r.stop.line) ||
    (r.start.line == p.line && r.start.character ≤ p.character) ||
    (r.stop.line == p.line && p.character ≤ r.stop.character)  
end

intersect(a::Range, b::Range) = a.start in b || b.start in a

get_linebreaks(doc) = [0; find(c->c==0x0a, doc.data); length(doc.data)+1]
get_linebreaks(data::Vector{UInt8}) = [0; find(c->c==0x0a, data); length(data)+1]

function get_pos(i0, lb)
    nlb = length(lb)-1
    for l in 1:nlb
        if lb[l] < i0 ≤ lb[l+1]
            return Position(l-1, i0-lb[l]-1)
        end
    end
end






function get_block(tdpp::TextDocumentPositionParams, server)
    for b in server.documents[tdpp.textDocument.uri].blocks
        if tdpp.position in b.range
            return b
        end
    end
    return 
end

function get_block(uri::AbstractString, str::AbstractString, server)
    for b in server.documents[uri].blocks
        if str==b.name
            return b
        end
    end
    return false
end

function get_type(sword::Vector, tdpp, server)
    t = get_type(sword[1],tdpp,server)
    for i = 2:length(sword)
        fn = get_fn(t, tdpp, server)
        if sword[i] in keys(fn)
            t = fn[sword[i]]
        else
            return ""
        end
    end
    return t
end

function get_type(word::AbstractString, tdpp::TextDocumentPositionParams, server)
    b = get_block(tdpp, server)
    if word in keys(b.localvar)
        t = string(b.localvar[word].t) 
    elseif word in (x->x.name).(server.documents[tdpp.textDocument.uri].blocks)
        t = get_block(tdpp.textDocument.uri, word, server).var.t
    elseif isdefined(Symbol(word)) 
        t = string(typeof(get_sym(word)))
    else
        t = "Any"
    end
    return t
end

function get_fn(t::AbstractString, tdpp::TextDocumentPositionParams, server)
    if t in (b->b.name).(server.documents[tdpp.textDocument.uri].blocks)
        b = get_block(tdpp.textDocument.uri, t, server)
        fn = Dict(k => string(b.localvar[k].t) for k in keys(b.localvar))
    elseif isdefined(Symbol(t)) 
        sym = get_sym(t)
        if isa(sym, DataType)
            fnames = string.(fieldnames(sym))
            fn = Dict(fnames[i]=>string(sym.types[i]) for i = 1:length(fnames))
        else
            fn = Dict()
        end
    else
        fn = Dict()
    end
    return fn
end
