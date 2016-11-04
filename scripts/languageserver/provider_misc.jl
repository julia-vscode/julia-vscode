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
                        TextDocumentSyncKind["Incremental"],
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

function Respond(r::Request{didOpen,DidOpenTextDocumentParams})
    try
        documents[r.params.textDocument.uri] = split(r.params.textDocument.text,r"\r\n?|\n")
        return Notification("textDocument/publishDiagnostics",PublishDiagnosticsParams(r.params.textDocument.uri))
    catch err
        return Response{didOpen,Exception}("2.0",r.id,err)
    end
end

abstract didClose <: Method

function Respond(r::Request{didClose,DidCloseTextDocumentParams})
    try
        delete!(documents,r.params.textDocument.uri)
        return
    catch err
        return Response{didClose,Exception}("2.0",r.id,err)
    end
end

abstract didChange <: Method

function Respond(r::Request{didChange,DidChangeTextDocumentParams})
        vtdi = r.params.textDocument
        C = r.params.contentChanges
        for c in C
            c(vtdi)
        end
    try
        return
    catch err
        return Response{didChange,Exception}("2.0",r.id,err)
    end
end

function (c::TextDocumentContentChangeEvent)(vtdi::VersionedTextDocumentIdentifier)
    d = join(documents[vtdi.uri],'\n').data
    X = c.text
    l,pos = 1,0

    while l<c.range.start.line+1
        pos+=1
        d[pos]==0x0a && (l+=1)
    end

    pos+=c.range.start.character+1
    for i = 1:c.rangeLength
        deleteat!(d,pos)
    end
    for x in X.data
        insert!(d,pos,x)
        pos+=1
    end
    documents[vtdi.uri] = split(String(d),r"\r\n?|\n")
    return
end
