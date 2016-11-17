function process(r::Request{Val{Symbol("textDocument/hover")},TextDocumentPositionParams}, server)
    tdpp = r.params
    word = get_word(tdpp,server)
    sword = split(word,'.')
    b = get_block(tdpp, server)
    if word == ""  
        send(Response(get(r.id), Hover([])), server)
        return
    end

    documentation = (sword[1] in keys(b.localvar) || get_block(tdpp.textDocument.uri, sword[1], server)!=false) && length(sword)>1 ? 
        [MarkedString(get_type(sword, tdpp, server))] : 
        MarkedString[]
    
    isempty(documentation) && (documentation = get_local_hover(word, tdpp, server))
    isempty(documentation) && (documentation = get_global_hover(word, tdpp, server))
    isempty(documentation) && (documentation = get_docs(r.params, server))
         
    response = Response(get(r.id), Hover(documentation))
    send(response, server)
end

function JSONRPC.parse_params(::Type{Val{Symbol("textDocument/hover")}}, params)
    return TextDocumentPositionParams(params)
end


function get_global_hover(word::AbstractString, tdpp::TextDocumentPositionParams, server)
    b = get_block(tdpp.textDocument.uri, word, server)
    hover = MarkedString[]
    if b!=false
        push!(hover, MarkedString("global: defined at $(sprintrange(b.range)) "))
        b.var.doc!="" && push!(hover,MarkedString(b.var.doc))
    end 
    return hover
end

function get_local_hover(word::AbstractString, tdpp::TextDocumentPositionParams, server)
    b = get_block(tdpp, server)
    hover = MarkedString[]
    if word in keys(b.localvar)
        v = b.localvar[word]
        push!(hover, MarkedString("local: $(v.doc) ::$(v.t)"))
    end 
    return hover
end