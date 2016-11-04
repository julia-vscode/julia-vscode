conn = STDOUT
(outRead, outWrite) = redirect_stdout()

if VERSION < v"0.5"
    error("VS Code julia language server only works with julia 0.5 or newer.")
end

include("dependencies.jl")
use_and_install_dependencies(["Compat", "JSON", "Lint", "URIParser","JuliaParser"])

if length(Base.ARGS)==1
    push!(LOAD_PATH, Base.ARGS[1])
elseif length(Base.ARGS)>1
    error("Invalid number of arguments passed to julia language server.")
end

include("jsonrpc.jl")
importall JSONRPC
include("protocol.jl")
include("languageserver.jl")
include("provider_diagnostics.jl")
include("provider_misc.jl")
include("provider_hover.jl")
include("provider_completions.jl")
include("provider_definitions.jl")
include("provider_signatures.jl")
include("transport.jl")

include("utilities.jl")

server = LanguageServer(STDIN,conn)
run(server)
