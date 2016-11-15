type Block{T}
    uptodate::Bool
    ex::Any
    range::Range
    name
    hover::MarkedString
    completions
    localvar::Dict
end

function Block(utd,ex,r::Range)
    t,name,lvars = classify_expr(ex)
    return Block{t}(utd, ex, r, name,MarkedString("Global"),[],lvars)
end

function Base.parse(uri::String,server::LanguageServer,updateall=false)
    doc = String(server.documents[uri].data) 
    n = length(doc.data)
    if doc == ""
        server.documents[uri].blocks = []
        return
    end
    linebreaks = get_linebreaks(doc)
    out = Block[]
    i0 = i1 = 1
    p0 = p1 = Position(0,0)

    while 0 < i1 ≤ n
        (ex,i1) = parse(doc,i0,raise=false)
        p0 = get_pos(i0, linebreaks)
        p1 = get_pos(i1-1, linebreaks)
        if isa(ex,Expr) && in(ex.head,[:incomplete,:error])
            push!(out,Block(false,ex,Range(p0,Position(p0.line+1,0))))
            while true
                !in(doc[i0],['\n','\t',' ']) && break
                i0+=1
            end
            i0 = i1 = search(doc,'\n',i0)
        else
            push!(out,Block(true,ex,Range(p0,p1)))
            i0 = i1
        end
    end
    server.documents[uri].blocks = out
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
                    if length(a.args)>1
                        args[a.args[1]] = string(a.args[2])
                    else
                        args[a.args[1]] = string(a.args[1])
                    end
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

import Base:<,in,intersect
<(a::Position,b::Position) =  a.line<b.line || (a.line ≤ b.line && a.character<b.character)
function in(p::Position,r::Range)
    (r.start.line < p.line < r.end.line) ||
    (r.start.line == p.line && r.start.character ≤ p.character) ||
    (r.end.line == p.line && p.character ≤ r.end.character)  
end

intersect(a::Range,b::Range) = a.start in b || b.start in a

get_linebreaks(doc) = [0;find(c->c==0x0a,doc.data);length(doc.data)+1]

function get_pos(i0, lb)
    nlb = length(lb)-1
    for l = 1:nlb
        if lb[l] < i0 ≤ lb[l+1]
            return Position(l-1,i0-lb[l]-1)
        end
    end
end

