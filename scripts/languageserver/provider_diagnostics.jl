const LintSeverity = Dict('E'=>1,'W'=>2,'I'=>3)

function process_diagnostics(uri::String, server::LanguageServer)
    L = lintfile(URI(replace(unescape(uri),"\\","/")).path[2:end],join(server.documents[uri],'\n'))
    diags = map(L) do l
        Diagnostic(Range(Position(l.line-1, 0), Position(l.line-1, typemax(Int)) ),
                        LintSeverity[string(l.code)[1]],
                        string(l.code),
                        "Lint.jl",
                        l.message)
    end
    publishDiagnosticsParams = PublishDiagnosticsParams(uri,diags)

    response =  Request{Val{Symbol("textDocument/publishDiagnostics")},PublishDiagnosticsParams}(Nullable{Union{String,Int}}(), publishDiagnosticsParams)
    send(response, server)
end
