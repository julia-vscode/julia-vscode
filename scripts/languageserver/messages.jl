function process_message_initialize(message)
    response = Dict()
    response["jsonrpc"] = "2.0"
    response["id"] = message["id"]
    response["result"] = Dict()
    response["result"]["capabilities"] = Dict()
    response["result"]["capabilities"]["textDocumentSync"] = 1
    response["result"]["capabilities"]["hoverProvider"] = true
    compopts = Dict("resolveProvider"=>false,"triggerCharacters"=>["."])
    response["result"]["capabilities"]["completionProvider"] = compopts
    response["result"]["capabilities"]["definitionProvider"] = true
    response["result"]["capabilities"]["signatureHelpProvider"] = Dict("triggerCharacters"=>["("])

    response_json = JSON.json(response)

    return response_json
end

function process_message_textDocument_didOpen(message)
    uri = message["params"]["textDocument"]["uri"]
    content = message["params"]["textDocument"]["text"]

    documents[uri] = split(content, r"\r\n?|\n")

    response = runlinter(uri, documents[uri])

    response_json = JSON.json(response)

    return response_json
end

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
