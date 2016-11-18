conn = STDOUT
(outRead, outWrite) = redirect_stdout()

if VERSION < v"0.5"
    error("VS Code julia language server only works with julia 0.5 or newer.")
end

using Compat
using JSON
using Lint
using URIParser
using LanguageServer

if length(Base.ARGS)!=2
    error("Invalid number of arguments passed to julia language server.")
end

if Base.ARGS[2]=="--debug=no"
    const global ls_debug_mode = false
elseif Base.ARGS[2]=="--debug=yes"
    const global ls_debug_mode = true
end

if !ls_debug_mode
    push!(LOAD_PATH, Base.ARGS[1])
end

server = LanguageServerInstance(STDIN,conn, ls_debug_mode)
run(server)
