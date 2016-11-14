const TextDocumentSyncKind = Dict("None"=>0,"Full"=>1,"Incremental"=>2)



const serverCapabilities = ServerCapabilities(
                        TextDocumentSyncKind["Incremental"],
                        true, #hoverProvider
                        CompletionOptions(false,["."]),
                        true, #definitionProvider
                        SignatureHelpOptions(["("])) 

function process(r::JSONRPC.Request{Val{Symbol("initialize")},Dict{String,Any}}, server)
    server.rootPath=haskey(r.params,"rootPath") ? r.params["rootPath"] : ""
    response = Response(get(r.id),InitializeResult(serverCapabilities))
    send(response, server)
end

function JSONRPC.parse_params(::Type{Val{Symbol("initialize")}}, params)
    return Any(params)
end

function process(r::Request{Val{Symbol("textDocument/didOpen")},DidOpenTextDocumentParams}, server)
    server.documents[r.params.textDocument.uri] = Document(r.params.textDocument.text.data,[]) 
    parse(r.params.textDocument.uri,server)
    
    if isworkspacefile(r.params.textDocument.uri,server) 
        process_diagnostics(r.params.textDocument.uri, server) 
    end
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
    doc = server.documents[r.params.textDocument.uri].data
    blocks = server.documents[r.params.textDocument.uri].blocks 
    for c in r.params.contentChanges 
        startline,endline = get_rangelocs(doc,c.range) 
        io = IOBuffer(doc) 
        seek(io,startline) 
        s = e = 0 
        while s<c.range.start.character 
            s+=1 
            read(io,Char) 
        end 
        startpos = position(io) 
        seek(io,endline) 
        while e<c.range.end.character 
            e+=1 
            read(io,Char) 
        end 
        endpos = position(io) 
        if length(doc)==0 
            doc = c.text.data 
        else 
            doc = vcat(doc[1:startpos],c.text.data,doc[endpos+1:end]) 
        end 
        if !isempty(blocks)
            s = e = 1
            while e <length(blocks)
                if blocks[e].range.start.line+1 ≤ c.range.start.line
                    s = e
                end
                if c.range.end.line ≤ blocks[e].range.end.line+1
                    break
                end
                e+=1
            end
            for i = s:e
                blocks[e].uptodate=false
            end
        end
    end 
    server.documents[r.params.textDocument.uri].data = doc 
    parse(r.params.textDocument.uri,server)
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