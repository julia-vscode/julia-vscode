function process(r::Request{Val{Symbol("textDocument/definition")},TextDocumentPositionParams}, server)
    word = get_word(r.params, server)
    x = get_sym(word)

    locations = map(methods(x).ms) do m
        (filename, line) = functionloc(m)
        filename_norm = normpath(filename)
        if is_windows()
            filename_norm = replace(filename_norm, '\\', '/')
        end
        filename_escaped = URIParser.escape(filename_norm)
        uri = "file:///$filename_escaped"
        return Location(uri, line-1)
    end

    response = Response(get(r.id),locations)
    send(response, server)
end

function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/definition")}}, params)
    return TextDocumentPositionParams(params)
end
