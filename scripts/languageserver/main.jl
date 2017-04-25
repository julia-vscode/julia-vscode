if VERSION < v"0.6"
    error("VS Code julia language server only works with julia 0.6 or newer.")
end

if length(Base.ARGS)!=2
    error("Invalid number of arguments passed to julia language server.")
end

conn = STDOUT
(outRead, outWrite) = redirect_stdout()

if Base.ARGS[2]=="--debug=no"
    const global ls_debug_mode = false
elseif Base.ARGS[2]=="--debug=yes"
    const global ls_debug_mode = true
end

push!(LOAD_PATH, joinpath(dirname(@__FILE__),"packages"))
push!(LOAD_PATH, Base.ARGS[1])

using Compat
using JSON
using URIParser
using LanguageServer

server = LanguageServerInstance(STDIN,conn, ls_debug_mode, Base.ARGS[1])
run(server)
