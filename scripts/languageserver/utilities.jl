function Line(p::TextDocumentPositionParams, documents)
    d = documents[p.textDocument.uri]
    return d[p.position.line+1]
end

function Word(p::TextDocumentPositionParams, documents, offset=0)
    line = Line(p, documents)
    s = e = max(1,p.position.character)+offset
    while e<=length(line) && Lexer.is_identifier_char(line[e])
        e+=1
    end
    while s>0 && (Lexer.is_identifier_char(line[s]) || line[s]=='.')
        s-=1
    end
    ret = line[s+1:e-1]
    ret = ret[1] == '.' ? ret[2:end] : ret
    return ret 
end

function getSym(str::String)
    name = split(str,'.')
    try
        x = getfield(Main,Symbol(name[1]))
        for i = 2:length(name)
            x = getfield(x,Symbol(name[i]))
        end
        return x
    catch
        return nothing
    end
end

getSym(p::TextDocumentPositionParams, documents) = getSym(Word(p, documents))

function docs(x)
    str = string(Docs.doc(x))
    if str[1:16]=="No documentation"
        s = last(search(str,"\n\n```\n"))+1
        e = first(search(str,"\n```",s))-1
        if isa(x,DataType)
            s1 = last(search(str,"\n\n```\n",e))+1
            e1 = first(search(str,"\n```",s1))-1
            d = vcat(str[s:e], split(str[s1:e1],'\n'))
        elseif isa(x,Function)
            d = split(str[s:e],'\n')
            s = last(search(str,"\n\n"))+1
            e = first(search(str,"\n\n",s))-1
            d = map(dd->(dd = dd[1:first(search(dd," in "))-1]),d)
            d[1] = str[s:e]
        elseif isa(x,Module)
            d = [split(str,'\n')[3]]
        else
            d = [""]
        end
    else
        d = split(str,"\n\n")
    end
    return d
end
docs(tdpp::TextDocumentPositionParams, documents) = docs(getSym(tdpp, documents))
