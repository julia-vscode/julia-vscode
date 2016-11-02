module _vscodeserver

pid = Base.ARGS[1]

if is_windows()
    global_lock_socket_name = "\\\\.\\pipe\\vscode-language-julia-terminal-$pid"
elseif is_unix() 
    global_lock_socket_name = joinpath(tempdir(), "vscode-language-julia-terminal-$pid")
else
    error("Unknown operating system.")
end

@async begin
    server = listen(global_lock_socket_name)
    while true
        sock = accept(server)
        @async while isopen(sock)

            header = String[]
            line = chomp(readline(sock))
            while length(line)>0
                push!(header,line)
                line = chomp(readline(sock))
            end
            header_dict = Dict{String,String}()
            for h in header
                h_parts = split(h, ":")
                header_dict[strip(h_parts[1])] = strip(h_parts[2])
            end
        
            message_length = parse(Int, header_dict["Content-Length"])
            message_command = header_dict["Command"]

            message_body = String(read(sock,message_length))

            if message_command == "run"
                command_eval = parse(message_body)
                eval(Main, command_eval)
            else
                error("Unknown command")
            end                               
        end
    end
 end

end
