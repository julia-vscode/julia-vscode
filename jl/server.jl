using JSON,JuliaParser
server = listen("juliaserver"*string(getpid()))

function getfullname(line::String,pos::Int)
    s = e = max(1,pos)
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

function definition(sock,request)
    line = request["params"]["line"]
    pos = request["params"]["pos"]
    name = split(getfullname(line,pos),'.')
    x = getfield(Main,Symbol(name[1]))
    for i = 2:length(name)
        x = getfield(x,Symbol(name[i]))
    end
    ms =map(functionloc,methods(x).ms)
    write(sock,JSON.json(Dict(
        "id"=>request["id"],
        "type"=>"definition",
        "defs"=>ms 
    )))
end

hover(sock,request) = write(sock,JSON.json(Dict(
                        "id"=>request["id"],
                        "type"=>"hover",
                        "doc"=>string(Docs.doc(getfield(Main,Symbol(request["params"]))))
                    )))

while true
    sock = accept(server)
    @async while isopen(sock)
        msg = readline(sock)
        try 
            request = JSON.Parser.parse(msg)
            if request["type"] == "hover"
                hover(sock,request)
            elseif request["type"] == "definition"
                definition(sock,request)
            end
        end
    end
end

