# Position
type Position
    line::Int
    character::Int
end
Position(d::Dict) = Position(d["line"],d["character"])
Position(line) = Position(line,0)
Position() = Position(-1,-1)

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

type Location
    uri::String
    range::Range
end
Location(d::Dict) = Location(d["uri"],Range(d["range"]))
Location(f::String,line) = Location(f,Range(line))

type MarkedString
    language::String
    value::AbstractString
end
MarkedString(x) = MarkedString("julia",x::AbstractString)

type Hover
    contents::Union{MarkedString,Vector{MarkedString}}
end

type CompletionItem
    label::String
    kind::Int
    documentation::String
end

type CompletionList
    isIncomplete::Bool
    items::Vector{CompletionItem}
end

type Diagnostic
    range::Range
    severity::Int
    code::String
    source::String
    message::String
end

type PublishDiagnosticsParams
    uri::String
    diagnostics::Vector{Diagnostic}
end

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

type ParameterInformation
    label::String
    #documentation::String
end

type SignatureInformation
    label::String
    documentation::String
    parameters::Vector{ParameterInformation}
end

type SignatureHelp
    signatures::Vector{SignatureInformation}
    activeSignature::Int
    activeParameter::Int
end

# TextDocument

type TextDocumentIdentifier
    uri::String
    TextDocumentIdentifier(d::Dict) = new(d["uri"])
end


type VersionedTextDocumentIdentifier
    uri::String
    version::Int
    VersionedTextDocumentIdentifier(d::Dict) = new(d["uri"],d["version"])
end



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
    DidChangeTextDocumentParams(d::Dict) = new(VersionedTextDocumentIdentifier(d["textDocument"]),TextDocumentContentChangeEvent.(d["contentChanges"]))
end


type TextDocumentItem
    uri::String
    languageId::String
    version::Int
    text::String
    TextDocumentItem(d::Dict) = new(d["uri"],d["languageId"],d["version"],d["text"])
end


type TextDocumentPositionParams
    textDocument::TextDocumentIdentifier
    position::Position
    TextDocumentPositionParams(d::Dict) = new(TextDocumentIdentifier(d["textDocument"]),Position(d["position"]))
end

type DidOpenTextDocumentParams
    textDocument::TextDocumentItem
    DidOpenTextDocumentParams(d::Dict) = new(TextDocumentItem(d["textDocument"]))
end

type DidCloseTextDocumentParams
    textDocument::TextDocumentIdentifier
    DidCloseTextDocumentParams(d::Dict) = new(TextDocumentIdentifier(d["textDocument"]))
end

type DidSaveTextDocumentParams
    textDocument::TextDocumentIdentifier
    DidSaveTextDocumentParams(d::Dict) = new(TextDocumentIdentifier(d["textDocument"]))
end

type CancelParams
    id::Union{String,Int}
    CancelParams(d::Dict) = new(d["id"])
end
