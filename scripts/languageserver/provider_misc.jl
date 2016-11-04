const TextDocumentSyncKind = Dict("None"=>0,"Full"=>1,"Incremental"=>2)



const serverCapabilities = ServerCapabilities(
                        TextDocumentSyncKind["Full"],
                        true, #hoverProvider
                        CompletionOptions(false,["."]),
                        true, #definitionProvider
                        SignatureHelpOptions(["("])) 

function process(r::JSONRPC.Request{Val{Symbol("initialize")},Dict{String,Any}}, server)
    response = Response(get(r.id),InitializeResult(serverCapabilities))
    send(response, server)
end

function JSONRPC.parse_params(::Type{Val{Symbol("initialize")}}, params)
    return Any(params)
end

function process(r::Request{Val{Symbol("textDocument/didOpen")},DidOpenTextDocumentParams}, server)
    server.documents[r.params.textDocument.uri] = split(r.params.textDocument.text,r"\r\n?|\n")
    
    process_diagnostics(r.params.textDocument.uri, server)
end

function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/didOpen")}}, params)
    return DidOpenTextDocumentParams(params)
end

function process(r::Request{Val{Symbol("textDocument/didClose")},DidCloseTextDocumentParams}, server)
    delete!(server.documents,r.params.textDocument.uri)
end

function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/didClose")}}, params)
    return DidCloseTextDocumentParams(params)
end

function process(r::Request{Val{Symbol("textDocument/didChange")},DidChangeTextDocumentParams}, server)
    server.documents[r.params.textDocument.uri] = split(r.params.contentChanges[1].text, r"\r\n?|\n")
end

function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/didChange")}}, params)
    return DidChangeTextDocumentParams(params)
end

function process(r::Request{Val{Symbol("\$/cancelRequest")},CancelParams}, server)
    
end


function JSONRPC.parse_params(::Type{Val{Symbol("\$/cancelRequest")}}, params)
    return CancelParams(params)
end

function process(r::Request{Val{Symbol("textDocument/didSave")},DidSaveTextDocumentParams}, server)
    
end


function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/didSave")}}, params)
    return DidSaveTextDocumentParams(params)
end