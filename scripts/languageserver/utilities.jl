function get_line(p::TextDocumentPositionParams, server::LanguageServer)
    d = server.documents[p.textDocument.uri]
    return d[p.position.line+1]
end

function get_word(tdpp::TextDocumentPositionParams, server::LanguageServer, offset=0)
    line = IOBuffer(get_line(tdpp, server))
    word = Char[]
    e = s = 0
    c = ' '
    while position(line)<tdpp.position.character+offset
        e+=1
        c = read(line,Char)
        push!(word,c)
        if !(Lexer.is_identifier_char(c) || c=='.')
            word = Char[]
            s = e
        end
    end
    while !eof(line) && Lexer.is_identifier_char(c)
        e+=1
        c = read(line,Char)
        Lexer.is_identifier_char(c) && push!(word,c)
    end
    for i = 1:2 # Delete junk at front
        !isempty(word) && in(word[1],[' ','.','!']) && deleteat!(word,1)
    end
    isempty(word) && (return "")
    return String(word)
end

function get_sym(str::String)
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

get_sym(p::TextDocumentPositionParams, server::LanguageServer) = get_sym(get_word(p, server))

function get_docs(x)
    str = string(Docs.doc(x))
    if str[1:16]=="No documentation"
        s = last(search(str,"\n\n```\n"))+1
        e = first(search(str,"\n```",s))-1
        if isa(x,DataType) && x!=Any && x!=Function
            d = MarkedString.(split(chomp(sprint(dump,x)),'\n'))
        elseif isa(x,Function)
            d = split(str[s:e],'\n')
            s = last(search(str,"\n\n"))+1
            e = first(search(str,"\n\n",s))-1
            d = MarkedString.(map(dd->(dd = dd[1:first(search(dd," in "))-1]),d))
            d[1] = MarkedString(str[s:e])
        elseif isa(x,Module)
            d = [split(str,'\n')[3]]
        else
            d = [""]
        end
    else
        d = split(str, "\n\n", limit = 2)
    end
    return d
end

get_docs(tdpp::TextDocumentPositionParams, server::LanguageServer) = get_docs(get_sym(tdpp, server))
