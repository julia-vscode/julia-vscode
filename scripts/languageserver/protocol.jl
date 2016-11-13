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
    contents::Vector{Union{AbstractString,MarkedString}}
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

type DidOpenTextDocumentParams
    textDocument::TextDocumentItem
end
DidOpenTextDocumentParams(d::Dict) = DidOpenTextDocumentParams(TextDocumentItem(d["textDocument"]))

type DidCloseTextDocumentParams
    textDocument::TextDocumentIdentifier
end
DidCloseTextDocumentParams(d::Dict) = DidCloseTextDocumentParams(TextDocumentIdentifier(d["textDocument"]))

type DidSaveTextDocumentParams
    textDocument::TextDocumentIdentifier
end
DidSaveTextDocumentParams(d::Dict) = DidSaveTextDocumentParams(TextDocumentIdentifier(d["textDocument"]))

type CancelParams
    id::Union{String,Int}
end
CancelParams(d::Dict) = CancelParams(d["id"])
