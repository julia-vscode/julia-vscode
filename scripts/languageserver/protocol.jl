# Position
type Position
    line::Int
    character::Int
end
Position(d::Dict) = Position(d["line"],d["character"])
Position(line) = Position(line,0)
Position() = Position(-1,-1)
isempty(p::Position) = p.line==-1 && p.character==-1

type Range
    start::Position
    finish::Position
end
Range(d::Dict) = Range(d["start"],d["end"])
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

type TextDocumentPositionParams
    textDocument::TextDocumentIdentifier
    position::Position
end
TextDocumentPositionParams(d::Dict) = TextDocumentPositionParams(TextDocumentIdentifier(d["textDocument"]),Position(d["position"]))


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
                      "initialize"]

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
    end
end

type Response{m<:Method,T} <: Message
    jsonrpc::String
    id::Int
    result::T
end




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


function checkmsg(response)
    n = length(response)
    io = IOBuffer()
    write(io, "Content-Length: $n\r\n\r\n")
    write(io, response)
    takebuf_string(io)
end

function first20lines(d::String)
    cnt = 0
    l10 = 0
    @inbounds @simd for i =1:length(d.data)
        cnt==20 && (l10=i)
        cnt+=d.data[i]==0x0a
    end
    return cnt,1:l10-1
end 

