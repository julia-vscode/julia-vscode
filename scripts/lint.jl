using Lint

function myownlint(filename, code)
    res = lintfile(filename, code)

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
        diag["range"]["start"]["line"] = msg.line
        diag["range"]["start"]["character"] = 0
        diag["range"]["end"] = Dict()
        diag["range"]["end"]["line"] = msg.line
        diag["range"]["end"]["character"] = typemax(Int)
        code = string(msg.code)
        if code[1]=='E'        
            diag["severity"] = 1
        elseif code[1]=='W'
            diag["severity"] = 2
        elseif code[1]=='I'
            diag["severity"] = 3
        else
            error("Unknown linter code.")
        end
        diag["code"] = code
        diag["message"] = msg.message
        push!(diagnosticMessage["params"]["diagnostics"], diag)
    end
    
    return diagnosticMessage
end
