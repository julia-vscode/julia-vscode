const LintSeverity = Dict('E'=>1,'W'=>2,'I'=>3)

type Diagnostic
    range::Range
    severity::Int
    code::String
    source::String
    message::String
    Diagnostic(l) = new(Range(l.line-1),
                        LintSeverity[string(l.code)[1]],
                        string(l.code),
                        l.file,
                        l.message)
end

type PublishDiagnosticsParams
    uri::String
    diagnostics::Vector{Diagnostic}
end

function PublishDiagnosticsParams(uri::String)
    L = lintfile(unescape(URI(uri).path)[2:end],join(documents[uri],'\n'))
    diags = Diagnostic.(L)
    return PublishDiagnosticsParams(uri,diags)
end