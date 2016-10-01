import JSON
using CodeTools

function getCompletionResults(line::String, pos::Int)
    names = Base.REPLCompletions.completions(line, pos)[1]
    return map(name -> CodeTools.withmeta(name, current_module()), names)
end

function evaluateCodeBlock(code::String)
    linecharc = cumsum(map(x->endof(x)+1, split(code, "\n")))
    pos = start(code)
    numlines = length(linecharc)
    while !done(code, pos)
        problem = false
        ex = nothing
        linerange = searchsorted(linecharc, pos)
        if linerange.start > numlines
            break
        else
            linebreakloc = linecharc[linerange.start]
        end
        if linebreakloc == pos || isempty(strip(code[pos:(linebreakloc-1)]))
            pos = linebreakloc + 1
            continue
        end
        ex = parse("")
        try
            (ex, pos) = parse(code, pos)
        catch y
            problem = true
        end
        if !problem
            eval(ex)
        else
            break
        end
    end
end

while true
    request = nothing
    process_message = false
    try
        text = readline()
        request = JSON.parse(text)
        process_message = true
    catch
        if isa(e, EOFError)
        else
            rethrow()
        end
    end

    if process_message
        if request["requestType"] == "completion"
            try
                id = request["id"]
                line = request["source"]
                pos = request["columnIndex"]
                rdata = getCompletionResults(line, pos)
                answer = Dict("id" => id, "results" => rdata)
                println(STDOUT, JSON.json(answer))
            end
        elseif request["requestType"] == "evaluation"
            try
                evaluateCodeBlock(request["source"])
            end
        end
    end
end
