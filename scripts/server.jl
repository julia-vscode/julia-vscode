module _vscodeserver
import JSON

@async begin
    server = listen("\\\\.\\pipe\\vscode-language-julia-server")
    while true
        sock = accept(server)
        @async while isopen(sock)
            msg = ""
            process_message = false
            try
                msg = JSON.parse(sock)
                process_message = true
            catch e
                if isa(e, EOFError)
                else
                    rethrow()
                end
            end

            if process_message
                if msg["command"] == "run"
                    command_string = msg["body"]
                    command_eval = parse(command_string)
                    eval(Main, command_eval)
                else
                    error("Unknown command")
                end                               
            end
        end
    end
end

end
