function get_line(tdpp::TextDocumentPositionParams, server::LanguageServer) 
    doc = server.documents[tdpp.textDocument.uri] 
    s = tdpp.position.line 
    n = length(doc) 
    cnt = 0 
    i = 0 
    while cnt<s && i<n 
        i+=1 
        if doc[i]==0x0a 
            cnt+=1 
        end 
    end 
    io = IOBuffer(doc) 
    seek(io,i) 
    return String(chomp(readuntil(io,'\n'))) 
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

function get_docs(tdpp::TextDocumentPositionParams, server::LanguageServer)
    word = get_word(tdpp,server)
    in(word,keys(server.DocStore)) && (return server.DocStore[word])
    sym = get_sym(word)
    d=[""]
    if sym!=nothing
        d = get_docs(sym)
        # Only keep 100 records
        if length(server.DocStore)>100
            for k in take(keys(server.DocStore),10)
                delete!(server.DocStore,k)
            end
        end
        server.DocStore[word] = d
    end
    return d
end

function get_rangelocs(d::Array{UInt8},range::Range) 
    (s,e) = (range.start.line, range.end.line) 
    n = length(d)  
    cnt = 0  
    i = 0  
    while cnt<s && i<n   
        i+=1  
        if d[i]==0x0a 
            cnt+=1  
        end  
    end  
    startline = i  
    while cnt<e && i<n   
        i+=1  
        if d[i]==0x0a 
            cnt+=1  
        end  
    end  
    endline = i  
    return startline,endline  
end

isworkspacefile(uri,server) = !ismatch(r"\/.*(julia).*\/(base)\/.*(.jl)",uri) && (server.rootPath == "" || (uri[1:7] == "file://" && ismatch(Regex("^$(server.rootPath)"),uri[8:end])) || uri[1:8] == "untitled") 
