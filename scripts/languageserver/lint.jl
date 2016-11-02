function runlinter(filename, code)
    filename2 = unescape(URI(filename).path)[2:end]

    res = lintfile(filename2, join(code,"\n"))

    diagnosticMessage = Dict()
    diagnosticMessage["jsonrpc"] = "2.0"
    diagnosticMessage["method"] = "textDocument/publishDiagnostics"
    diagnosticMessage["params"] = Dict()
    diagnosticMessage["params"]["uri"] = filename
    diagnosticMessage["params"]["diagnostics"] = Dict[]

    for msg in res
        diag = Dict()
        diag["range"] = Dict()
        diag["range"]["start"] = Dict()
        diag["range"]["start"]["line"] = msg.line-1
        diag["range"]["start"]["character"] = findfirst(i->i!=' ', code[msg.line])-1
        diag["range"]["end"] = Dict()
        diag["range"]["end"]["line"] = msg.line-1
        diag["range"]["end"]["character"] = typemax(Int)
        diag_code = string(msg.code)
        if diag_code[1]=='E'        
            diag["severity"] = 1
        elseif diag_code[1]=='W'
            diag["severity"] = 2
        elseif diag_code[1]=='I'
            diag["severity"] = 3
        else
            error("Unknown linter code.")
        end
        diag["code"] = diag_code
        diag["message"] = msg.message
        push!(diagnosticMessage["params"]["diagnostics"], diag)
    end
    
    return diagnosticMessage
end
