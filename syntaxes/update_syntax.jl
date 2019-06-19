# Converts the latest grammar from atom-language-julia to one compatible with vscode
# Requires:
#  - HTTP.jl to be installed;
#  - `cson2json` to be on your path. (Install via npm.)

import HTTP

const url = "https://raw.githubusercontent.com/JuliaEditorSupport/atom-language-julia/master/grammars/julia.cson"

HTTP.open("GET", url) do cson
  open(pipeline(`cson2json`, stdin=IOBuffer(read(cson))), "r") do c2j
    # get the raw json
    json = read(c2j, String)

    # apply substitutions
    sub!(pr) = json = replace(json, pr; count=typemax(Int))

    # when the juliamarkdown grammar is converted into an injection, this will also highlight embedded julia
    sub!(r"(\"include\"\s*:\s*\")source\.gfm(\")" => s"\1text.html.markdown\2")
    sub!(r"(\"include\"\s*:\s*\"source\.cpp)(\")" => s"\1#root_context\2")
    sub!(r"(\"contentName\"\s*:\s*\")source\.cpp(\")" => s"\1meta.embedded.block.cpp\2")
    sub!(r"(\"contentName\"\s*:\s*\")source\.gfm(\")" => s"\1meta.embedded.block.markdown\2")
    sub!(r"(\"contentName\"\s*:\s*\")source\.js(\")" => s"\1meta.embedded.block.js\2")
    sub!(r"(\"contentName\"\s*:\s*\")source\.r(\")" => s"\1meta.embedded.block.r\2")
    sub!(r"(\"contentName\"\s*:\s*\")source\.python(\")" => s"\1meta.embedded.block.python\2")

    # print out the transformed syntax
    println(json)
  end
end

##
