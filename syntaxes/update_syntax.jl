#! julia
# Converts an atom-language-julia grammar into one compatible with vscode
# Requires:
#  - HTTP.jl to be installed;
#  - `cson2json` to be on your path. (Install via npm.)
import HTTP

url = "https://raw.githubusercontent.com/JuliaEditorSupport/atom-language-julia/master/grammars/julia.cson"

# get cson - download if filename not given
cson = isempty(ARGS) ? String(HTTP.get(url).body) : read(ARGS[1], String)

# convert cson to json
json = Ref(read(open(pipeline(`cson2json`, stdin=IOBuffer(cson))), String))

# apply substitutions
sub!(pr) = json.x = replace(json.x, pr; count=typemax(Int))

sub!(r"(\"include\"\s*:\s*\")source\.gfm(\")" => s"\1text.html.markdown.julia\2")

# Skip over-zealous top-level production in `source.cpp`. See offending pattern here:
# https://github.com/microsoft/vscode/blob/c3fe2d8acde04e579880413ae4622a1f551efdcc/extensions/cpp/syntaxes/cpp.tmLanguage.json#L745
sub!(r"(\"include\"\s*:\s*\"source\.cpp)(\")" => s"\1#root_context\2")

# Choose content names consistent with the vscode conventions for embedded code. Cf.:
# https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide#embedded-languages
sub!(r"(\"contentName\"\s*:\s*\")source\.cpp(\")" => s"\1meta.embedded.block.cpp\2")
sub!(r"(\"contentName\"\s*:\s*\")source\.gfm(\")" => s"\1meta.embedded.block.markdown\2")
sub!(r"(\"contentName\"\s*:\s*\")source\.js(\")" => s"\1meta.embedded.block.javascript\2")
sub!(r"(\"contentName\"\s*:\s*\")source\.r(\")" => s"\1meta.embedded.block.r\2")
sub!(r"(\"contentName\"\s*:\s*\")source\.python(\")" => s"\1meta.embedded.block.python\2")

# print out the transformed syntax
println(json.x)
