conn = STDOUT
(outRead, outWrite) = redirect_stdout()

if VERSION < v"0.5"
    error("VS Code julia language server only works with julia 0.5 or newer.")
end

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

include("dependencies.jl")
use_and_install_dependencies([
    ("Compat", v"0.9.4"),
    ("JSON", v"0.8.0"),
    ("Lint", v"0.2.5"),
    ("URIParser", v"0.1.6"),
    ("LanguageServer", v"0.0.1")], ls_debug_mode)


server = LanguageServerInstance(STDIN,conn, ls_debug_mode)
run(server)
