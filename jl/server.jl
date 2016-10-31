using JSON
server = listen("juliaserver"*string(getpid()))

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
            end
        end
    end
end

