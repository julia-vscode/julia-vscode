const LintSeverity = Dict('E'=>1,'W'=>2,'I'=>3)

function process_diagnostics(uri::String, server::LanguageServer)
    document = String(server.documents[uri].data)
    L = lintfile(URI(replace(unescape(uri),"\\","/")).path[2:end], String(document))
    diags = map(L) do l
        start_col = findfirst(i->i!=' ', get_line(uri, l.line-1, server))-1
        Diagnostic(Range(Position(l.line-1, start_col), Position(l.line-1, typemax(Int)) ),
                        LintSeverity[string(l.code)[1]],
                        string(l.code),
                        "Lint.jl",
                        l.message)
    end
    publishDiagnosticsParams = PublishDiagnosticsParams(uri, diags)

    response =  Request{Val{Symbol("textDocument/publishDiagnostics")},PublishDiagnosticsParams}(Nullable{Union{String,Int}}(), publishDiagnosticsParams)
    send(response, server)
end
