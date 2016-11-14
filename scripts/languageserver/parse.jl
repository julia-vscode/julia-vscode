type Block{T}
    uptodate::Bool
    ex::Any
    range::Range
    name
    hover::MarkedString
    completions
    localvar::Dict
end

function Block(ex,r::Range)
    t,name,lvars = classify_expr(ex)
    return Block{t}(true, ex, r, name,MarkedString("Global"),[],lvars)
end

function Base.parse(uri::String,server::LanguageServer)
    doc = String(server.documents[uri].data) 
    if doc == ""
        server.documents[uri].blocks = []
        return
    end
    n = length(doc)
    ln = get_lineranges(doc)
    nl = length(ln)

    blocks = server.documents[uri].blocks
    out = Block[]
    if isempty(blocks)
        i0 = i1 = l0 = l1 = 1
        igood = 0
    else
        ibad = findfirst(b->!b.uptodate,blocks)
        ibad ==0 && return
        igood = ibad ==0 ? 0 : findnext(b->b.uptodate,blocks,ibad)
        bbad = blocks[ibad]
        igood!=0 && (bgood = blocks[igood])
        i0 = i1 = ln[min(nl,bbad.range.start.line+1)][1]
        l0 = l1 = min(nl,bbad.range.start.line+1)
    end

    while i1 ≤ n
        (ex,i1) = try
            parse(doc,i0)
        catch y
            y,i0
        end
        l0,p0 = get_pos(ln,i0,l1)
        l1,p1 = get_pos(ln,i1,l0)
        if isa(ex,ParseError) || (isa(ex,Expr) && ex.head==:incomplete)
            push!(out,Block(ex,Range(Position(l0-1,p0),Position(l0-1,ln[l0].stop-ln[l0].start))))
            while true
                if !in(doc[i0],['\n','\t',' '])
                    break
                end
                i0+=1
            end
            i0 = i1 = search(doc,'\n',i0)
            l0 += 1
            l1 += 1
            i0 == 0 && break
        else
            push!(out,Block(ex,Range(Position(l0-1,p0),Position(l1-1,p1))))
            i0 = i1
        end
        igood!=0 && bgood.ex==ex && break
    end
    if isempty(blocks)
        server.documents[uri].blocks = out
    else
        if igood!=0 
            dl,dc = out[end].range.start.line-bgood.range.start.line,out[end].range.start.character-bgood.range.start.character
            for i = igood:length(blocks)
                blocks[i].range.start.line = blocks[i].range.start.line+dl
                blocks[i].range.start.character = blocks[i].range.start.character+dc
                blocks[i].range.end.line = blocks[i].range.end.line+dl
                blocks[i].range.end.character = blocks[i].range.end.character+dc
            end
            for i = 2:length(out)-1
                deleteat!(blocks,ibad+i-1)
            end
        end
        blocks[ibad] = out[1]
        for i = 2:length(out)-1        
            insert!(blocks,ibad+i-1,out[i])
        end
    end
    return 
end 




function classify_expr(ex)
    if isa(ex, Expr)
        if ex.head==:macrocall && ex.args[1]==GlobalRef(Core,Symbol("@doc"))
            return classify_expr(ex.args[3])
        elseif ex.head==:function || (ex.head==:(=) && isa(ex.args[1],Expr) && ex.args[1].head==:call)
            name = isa(ex.args[1].args[1],Symbol) ? ex.args[1].args[1] : ex.args[1].args[1].args[1]
            args = Dict()
            for a in ex.args[1].args[2:end]
                if isa(a, Symbol)
                    args[a] = "Any"
                elseif a.head==:(::)
                    args[a.args[1]] = string(a.args[2])
                elseif a.head == :kw
                    if isa(a.args[1], Symbol)
                        args[a.args[1]] = "Any"
                    else
                        args[a.args[1].args[1]] = string(a.args[1].args[2])
                    end 
                elseif a.head == :parameters
                    if isa(a.args[1], Symbol)
                        args[a.args[1]] = "Any"
                    else 
                        args[a.args[1].args[1]] = string(a.args[1].args[2])
                    end
                end
            end 
            return :function, ex.args[1].args[1], args
        elseif ex.head==:macro
            return :macro, ex.args[1].args[1], Dict(x=>"macro argument" for x in ex.args[1].args[2:end])
        elseif in(ex.head,[:type, :immutable])
            name = isa(ex.args[2], Symbol) ? ex.args[2] : ex.args[2].args[1]
            args = Dict()
            for a in ex.args[3].args 
                if isa(a, Symbol)
                    args[a] = "Any"
                elseif a.head==:(::)
                    args[a.args[1]] = string(a.args[2])
                end
            end
            return ex.head, name, args
        elseif in(ex.head,[:abstract, :bitstype])
            name = isa(ex.args[1], Symbol) ? ex.args[1] : ex.args[1].args[1]
            return ex.head, name, Dict()
        elseif ex.head==:module
            return ex.head, ex.args[2], Dict()
        elseif ex.head == :(=) && isa(ex.args[1],Symbol)
            return :any, ex.args[1], Dict()
        end
    end
    return :none, :none, Dict()
end

import Base:<,in
<(a::Position,b::Position) =  a.line<b.line || (a.line ≤ b.line && a.character<b.character)
function in(p::Position,r::Range)
    (r.start.line < p.line < r.end.line) ||
    (r.start.line == p.line && r.start.character ≤ p.character) ||
    (r.end.line == p.line && p.character ≤ r.end.character)  
end

function get_lineranges(doc::String) 
    n = length(doc) 
    ln = UnitRange{Int}[] 
    i0 = i1 =  1 
    while i1 ≤ n 
        i1 = search(doc,'\n',i0) 
        push!(ln,min(i0,n):(i1 == 0 ? n : i1)) 
        i1==0 && break 
        i0=i1+1
    end 
    return  ln
end 

function get_pos(lineranges,charpos,startline=1)
    nl = length(lineranges)
    l,c = startline,0
    for l = startline:nl
        if lineranges[l].start ≤ charpos ≤ lineranges[l].stop
            c = charpos-lineranges[l].start
            break
        end
    end
    return l,c
end
