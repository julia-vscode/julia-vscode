# Position
type Position
    line::Int
    character::Int
end
Position(d::Dict) = Position(d["line"],d["character"])
Position(line) = Position(line,0)
Position() = Position(-1,-1)
isempty(p::Position) = p.line==-1 && p.character==-1


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

function Request(d::Dict)
    m = d["method"]
    if m=="textDocument/hover"
        return Request{hover,TextDocumentPositionParams}(d["id"],TextDocumentPositionParams(d["params"]))
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

function Word(p::TextDocumentPositionParams)
    line = Line(p)
    s = e = max(1,p.position.character)
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

function getSym(p::TextDocumentPositionParams)
    name = split(Word(p),'.')
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

