abstract initialize <: Method

const TextDocumentSyncKind = Dict("None"=>0,"Full"=>1,"Incremental"=>2)

type CompletionOptions 
    resolveProvider::Bool
    triggerCharacters::Vector{String}
end

type SignatureHelpOptions
    triggerCharacters::Vector{String}
end

type ServerCapabilities
    textDocumentSync::Int
    hoverProvider::Bool
    completionProvider::CompletionOptions
    definitionProvider::Bool
    signatureHelpProvider::SignatureHelpOptions
    # referencesProvider::Bool
    # documentHighlightProvider::Bool
    # documentSymbolProvider::Bool
    # workspaceSymbolProvider::Bool
    # codeActionProvider::Bool
    # codeLensProvider::CodeLensOptions
    # documentFormattingProvider::Bool
    # documentRangeFormattingProvider::Bool
    # documentOnTypeFormattingProvider::DocumentOnTypeFormattingOptions
    # renameProvider::Bool
end

type InitializeResult
    capabilities::ServerCapabilities
end

const serverCapabilities = ServerCapabilities(
                        TextDocumentSyncKind["Full"],
                        true, #hoverProvider
                        CompletionOptions(false,["."]),
                        true, #definitionProvider
                        SignatureHelpOptions(["("])) 

function Respond(r::Request{initialize,Any})
    try
        return Response{hover,InitializeResult}("2.0",r.id,InitializeResult(serverCapabilities))
    catch err
        return Response{hover,Exception}("2.0",r.id,err)
    end
end



abstract didOpen <: Method

function Respond(r::Request{didOpen,TextDocumentItem})
    try
        documents[r.params.uri] = split(r.params.text,r"\r\n?|\n")
        
        return Notification("textDocument/publishDiagnostics",PublishDiagnosticsParams(r.params.uri))
    catch err
        return Response{didOpen,Exception}("2.0",r.id,err)
    end
end

abstract didChange <: Method

function Respond(r::Request{didChange,TextDocumentItem})
    try
        documents[r.params.uri] = split(r.params.text,r"\r\n?|\n")
        
        return Notification("textDocument/publishDiagnostics",PublishDiagnosticsParams(r.params.uri))
    catch err
        return Response{didOpen,Exception}("2.0",r.id,err)
    end
end
