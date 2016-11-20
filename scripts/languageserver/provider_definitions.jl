function process(r::Request{Val{Symbol("textDocument/definition")},TextDocumentPositionParams}, server)
    word = get_word(r.params, server)
    x = get_sym(word)

    locations = map(methods(x).ms) do m
        (filename, line) = functionloc(m)
        @static if is_windows()
            filename_norm = normpath(filename)
            filename_norm = replace(filename_norm, '\\', '/')
            filename_escaped = URIParser.escape(filename_norm)
            uri = "file:///$filename_escaped"
        else
            uri = "file:$filename"
        end
        return Location(uri, line-1)
    end

    response = Response(get(r.id),locations)
    send(response, server)
end

function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/definition")}}, params)
    return TextDocumentPositionParams(params)
end
