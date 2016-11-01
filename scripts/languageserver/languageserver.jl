if VERSION < v"0.4" || VERSION >= v"0.6-"
    println("VS Code linter only works with julia 0.4 and 0.5")
else
    lock_aquired = false
    while !lock_aquired
        try
            @windows_only global_lock_socket_name = "\\\\.\\pipe\\vscode-language-server-global-lock"
            @unix_only global_lock_socket_name = joinpath(tempdir(), "vscode-language-server-global-lock")
            socket = listen(global_lock_socket_name)
            try
                try
                    eval(parse("using Lint"))
                    eval(parse("using JSON"))
                catch e
                    println("Installing Lint package")
                    Pkg.init()
                    Pkg.add("Compat", v"0.9.2")
                    Pkg.add("Lint", v"0.2.5")
                    Pkg.add("JSON")
                    eval(parse("using Lint"))
                end
            finally
                close(socket)
                lock_aquired = true
            end
        catch e
            info("Another julia lint process is currently updating packages, trying again in 1 second.")
            sleep(1.)
        end
    end

    if length(Base.ARGS)!=2
        error()
    end

    push!(LOAD_PATH, Base.ARGS[2])

    include("lint.jl")

    function read_transport_layer(conn)
    header = String[]
    line = chomp(readline(conn))
    while length(line)>0
        push!(header,line)
        line = chomp(readline(conn))
    end
    header_dict = Dict{String,String}()
    for h in header
        h_parts = split(h, ":")
        header_dict[chomp(h_parts[1])] = chomp(h_parts[2])
    end
    message_length = parse(Int, header_dict["Content-Length"])

    message = read(conn,message_length)
    message_str = String(message)
    return message_str    
end

function write_transport_layer(conn, response)
    n = length(response)
    write(conn, "Content-Length: $n\r\n\r\n")
    write(conn, response)
end

function process_message_initialize(message)
    println("process initialize message")
    response = Dict()
    response["jsonrpc"] = "2.0"
    response["id"] = message["id"]
    response["result"] = Dict()
    response["result"]["capabilities"] = Dict()
    response["result"]["capabilities"]["textDocumentSync"] = 1

    response_json = JSON.json(response)

    return response_json
end

function process_message_textDocument_didOpen(message)
println("process didOpen message")
    uri = message["params"]["textDocument"]["uri"]
    content = message["params"]["textDocument"]["text"]

    documents[uri] = content

    not = myownlint(uri, content)

    return JSON.json(not)
end

function process_message_textDocument_didChange(message)
println("process didChange message")
    uri = message["params"]["textDocument"]["uri"]
    content = message["params"]["contentChanges"][1]["text"]

    documents[uri] = content

    return nothing
end

function process_message_textDocument_didClose(message)
    uri = message["params"]["textDocument"]["uri"]

    delete!(documents, uri)

    return nothing
end


server = listen(Base.ARGS[1])
println("julia language server running on $(Base.ARGS[1])")
documents = Dict{String,String}()
while true
  conn = accept(server)
  @async begin
    try
      while true
        message = read_transport_layer(conn)
        message_json = JSON.parse(message)

        response = nothing
        if message_json["method"]=="initialize"
            response = process_message_initialize(message_json)
        elseif message_json["method"]=="textDocument/didOpen"
            response = process_message_textDocument_didOpen(message_json)
        elseif message_json["method"]=="textDocument/didChange"
            process_message_textDocument_didChange(message_json)
        elseif message_json["method"]=="textDocument/didClose"
            process_message_textDocument_didClose(message_json)
        elseif message_json["method"]=="textDocument/didSave"
            nothing
        else
            error("Unknown message $(message_json["method"])")
        end

        if response!=nothing
            write_transport_layer(conn,response)
        end
      end
    catch err
      print("connection ended with error $err")
    end
  end
end

end














