
function process_message_textDocument_didChange(message)
    uri = message["params"]["textDocument"]["uri"]
    content = message["params"]["contentChanges"][1]["text"]

    documents[uri] = split(content, r"\r\n?|\n")

    return nothing
end

function process_message_textDocument_didClose(message)
    uri = message["params"]["textDocument"]["uri"]

    delete!(documents, uri)

    return nothing
end
