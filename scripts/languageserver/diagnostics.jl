const LintSeverity = Dict('E'=>1,'W'=>2,'I'=>3)

type Diagnostic
    range::Range
    severity::Int
    code::String
    source::String
    message::String
    Diagnostic(l) = new(Range(Position(l.line-1, 0), Position(l.line-1, typemax(Int)) ),
                        LintSeverity[string(l.code)[1]],
                        string(l.code),
                        "Lint.jl",
                        l.message)
end

type PublishDiagnosticsParams
    uri::String
    diagnostics::Vector{Diagnostic}
    function PublishDiagnosticsParams(uri::String)
        L = lintfile(unescape(URI(uri).path)[2:end],join(documents[uri],'\n'))
        diags = Diagnostic.(L)
        return new(uri,diags)
    end
end

