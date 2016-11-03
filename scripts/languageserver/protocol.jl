# Position
type Position
    line::Int
    character::Int
end
Position(d::Dict) = Position(d["line"],d["character"])
Position(line) = Position(line,0)
Position() = Position(-1,-1)
isempty(p::Position) = p.line==-1 && p.character==-1

#type Range
#    start::Position
#    finish::Position
#end
let ex=:(type Range
        start::Position
        finish::Position
    end)
    ex.args[3].args=ex.args[3].args[[2;4]]
    ex.args[3].args[2].args[1]=Symbol("end")
    eval(ex)
end

Range(d::Dict) = Range(Position(d["start"]),Position(d["end"]))
Range(line) = Range(Position(line),Position(line))
isempty(r::Range) = isempty(r.start) && isempty(r.finish)

type Location
    uri::String
    range::Range
end
Location(d::Dict) = Location(d["uri"],Range(d["range"]))
Location(f::String,line) = Location(f,Range(line))





# TextDocument

type TextDocumentIdentifier
    uri::String
end
TextDocumentIdentifier(d::Dict) = TextDocumentIdentifier(d["uri"])


type VersionedTextDocumentIdentifier
    uri::String
    version::Int
end
VersionedTextDocumentIdentifier(d::Dict) = VersionedTextDocumentIdentifier(d["uri"],d["version"])


# WILL NEED CHANGING
type TextDocumentContentChangeEvent 
    #range::Range
    #rangeLength::Int
    text::String
end
#TextDocumentContentChangeEvent(d::Dict) = TextDocumentContentChangeEvent(Range(d["range"]),d["rangeLength"],d["text"])
TextDocumentContentChangeEvent(d::Dict) = TextDocumentContentChangeEvent(d["text"])


type DidChangeTextDocumentParams
    textDocument::VersionedTextDocumentIdentifier
    contentChanges::Vector{TextDocumentContentChangeEvent}
end

DidChangeTextDocumentParams(d::Dict) = DidChangeTextDocumentParams(VersionedTextDocumentIdentifier(d["textDocument"]),TextDocumentContentChangeEvent.(d["contentChanges"]))

type TextDocumentItem
    uri::String
    languageId::String
    version::Int
    text::String
end
TextDocumentItem(d::Dict) = TextDocumentItem(d["uri"],d["languageId"],d["version"],d["text"])


type TextDocumentPositionParams
    textDocument::TextDocumentIdentifier
    position::Position
end
TextDocumentPositionParams(d::Dict) = TextDocumentPositionParams(TextDocumentIdentifier(d["textDocument"]),Position(d["position"]))


type Notification
    jsonrpc::String
    method::String
    params::Any
end
Notification(method,params)=Notification("2.0",method,params)


# Messages
abstract Message
abstract Method

type Request{m<:Method,T} <: Message
    id::Int
    params::T
end

const ProviderList = ["textDocument/hover"
                      "textDocument/completion"
                      "textDocument/definition"
                      "textDocument/signatureHelp"
                      "initialize"
                      "textDocument/didOpen"
                      "textDocument/didChange"
                      "textDocument/didClose"
                      "textDocument/didSave" #does nothing
                      "\$/cancelRequest"] #does nothing

function Request(d::Dict)
    m = d["method"]
    if m=="textDocument/hover"
        return Request{hover,TextDocumentPositionParams}(d["id"],TextDocumentPositionParams(d["params"]))
    elseif m=="textDocument/completion"
        return Request{completion,TextDocumentPositionParams}(d["id"],TextDocumentPositionParams(d["params"]))
    elseif m=="textDocument/definition"
        return Request{definition,TextDocumentPositionParams}(d["id"],TextDocumentPositionParams(d["params"]))
    elseif m=="textDocument/signatureHelp"
        return Request{signature,TextDocumentPositionParams}(d["id"],TextDocumentPositionParams(d["params"]))
    elseif m=="initialize"
        return Request{initialize,Any}(d["id"],Any(d["params"]))
    elseif m=="textDocument/didOpen"
        return Request{didOpen,TextDocumentItem}(-1,TextDocumentItem(d["params"]["textDocument"]))
    elseif m=="textDocument/didChange"
        return Request{didChange,DidChangeTextDocumentParams}(-1,DidChangeTextDocumentParams(d["params"]))
    elseif m=="textDocument/didClose"
        return Request{didClose,TextDocumentIdentifier}(-1,TextDocumentIdentifier(d["params"]["textDocument"]))
    end
end

type Response{m<:Method,T} <: Message
    jsonrpc::String
    id::Int
    result::T
end

Respond(t::Void) = nothing




# Utilities
function Line(p::TextDocumentPositionParams)
    d = documents[p.textDocument.uri]
    return d[p.position.line+1]
end

function Word(p::TextDocumentPositionParams,offset=0)
    line = Line(p)
    s = e = max(1,p.position.character)+offset
    while e<=length(line) && Lexer.is_identifier_char(line[e])
        e+=1
    end
    while s>0 && (Lexer.is_identifier_char(line[s]) || line[s]=='.')
        s-=1
    end
    ret = line[s+1:e-1]
    ret = ret[1] == '.' ? ret[2:end] : ret
    return ret 
end

function getSym(str::String)
    name = split(str,'.')
    try
        x = getfield(Main,Symbol(name[1]))
        for i = 2:length(name)
            x = getfield(x,Symbol(name[i]))
        end
        return x
    catch
        return nothing
    end
end

getSym(p::TextDocumentPositionParams) = getSym(Word(p))