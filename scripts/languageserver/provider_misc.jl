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

# function Respond(r::Request{didChange,DidChangeTextDocumentParams})
#     try
#         documents[r.params.textDocument.uri] = split(r.params.contentChanges[1].text, r"\r\n?|\n")
#         return
#     catch err
#         return Response{didChange,Exception}("2.0",r.id,err)
#     end
# end

function Respond(r::Request{didChange,DidChangeTextDocumentParams})
        vtdi = r.params.textDocument
        C = r.params.contentChanges
        for c in C
            c(vtdi)
        end
        info(documents[vtdi.uri])
    try
        return
    catch err
        return Response{didChange,Exception}("2.0",r.id,err)
    end
end

function (c::TextDocumentContentChangeEvent)(vtdi::VersionedTextDocumentIdentifier)
    td = join(documents[vtdi.uri],'\n').data

    s = max(findnth(td,c.range.start.line)+c.range.start.character,1)
    if c.rangeLength>0
        for t in 1:c.rangeLength
            deleteat!(td,s)
        end
    end
    
    if length(c.text)>0
        for t in c.text
            insert!(td,s,t)
            s = min(s+1,length(td)+1)
        end
    end
    documents[vtdi.uri] = split(String(td),r"\r\n?|\n")
    return
end



function findnth(d::Array{UInt8},n,x=0x0a)
    cnt = 0
    for i =1:length(d)
        cnt+=d[i]==x
        cnt==n && return i
    end
    length(d)
end
