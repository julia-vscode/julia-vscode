function get_line(tdpp::TextDocumentPositionParams, server::LanguageServer)
    d = server.documents[tdpp.textDocument.uri]
    return d[tdpp.position.line+1]
end

function get_word(tdpp::TextDocumentPositionParams, server::LanguageServer, offset=0)
    line = IOBuffer(get_line(tdpp, server))
    word = Char[]
    e = s = 0
    c = ' '
    
    while position(line)<tdpp.position.character
        e+=1
        c = read(line,Char)
        push!(word,c)
        p = position(line)
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
    isempty(word) && (return "")
    for i = 1:2 # Delete junk at front
        in(word[1],[' ','.','!']) && deleteat!(word,1)
    end
    return String(word)
end

function get_sym(str::String)
    name = split(str,'.')
    x =  nothing
    try
        x = getfield(Main,Symbol(name[1]))
        for i = 2:length(name)
            x = getfield(x,Symbol(name[i]))
        end
    end
    return x
end

get_sym(tdpp::TextDocumentPositionParams, server::LanguageServer) = get_sym(get_word(tdpp, server))

function get_docs(x)
    str = string(Docs.doc(x))
    if str[1:16]=="No documentation"
        s = last(search(str,"\n\n```\n"))+1
        e = first(search(str,"\n```",s))-1
        if isa(x,DataType)
            s1 = last(search(str,"\n\n```\n",e))+1
            e1 = first(search(str,"\n```",s1))-1
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
        d = split(str,"\n\n",limit=2)
    end
    return d
end

get_docs(tdpp::TextDocumentPositionParams, server::LanguageServer) = get_docs(get_sym(tdpp, server))
