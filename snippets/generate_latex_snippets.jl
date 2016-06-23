# This code generates the file latex_snippets.json from all the latex
# symbols that are available for the REPL completion.
open("latex_snippets.json", "w") do f
    println(f, "{")
    for (i, (key,val)) in enumerate(Base.REPLCompletions.latex_symbols)
        nicename = key[2:end]        
        if i>1
            println(f, ",")
        end
        println(f, "\t\"$nicename\": {")
        println(f, "\t\t\"prefix\": \"\\\\$nicename\",")
        println(f, "\t\t\"body\": [ \"$val\" ],")
        println(f, "\t\t\"description\": \"$nicename\",")
        println(f, "\t\t\"scope\": \"source.julia\"")
        print(f, "\t}")
    end
    println(f)
    println(f, "}")
end
