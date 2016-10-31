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
    name = split(getfullname(request["params"]["line"],request["params"]["pos"]),'.')
    x = getfield(Main,Symbol(name[1]))
    for i = 2:length(name)
        x = getfield(x,Symbol(name[i]))
    end
    write(sock,JSON.json(Dict(
        "id"=>request["id"],
        "type"=>"definition",
        "defs"=>map(functionloc,methods(x).ms)
    )))
end

function completions(sock,request)
    name = getfullname(request["params"]["line"],request["params"]["pos"])
    write(sock,JSON.json(Dict(
        "id"=>request["id"],
        "type"=>"completions",
        "completionitems"=>Base.REPLCompletions.completions(request["params"]["line"],request["params"]["pos"])[1]
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
            elseif request["type"] == "completions"
                completions(sock,request)
            end
        end
    end
end

