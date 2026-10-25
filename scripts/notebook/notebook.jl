println(Base.stderr, "Starting notebook kernel server")

# load_vscodeserver.jl loads the package named here along with VSCodeServer. `eval`, because Julia
# before 1.3 has no `var"…"` syntax for the name, whose `#` hides it from the workspace view.
Core.eval(Main, :(const $(Symbol("#vscode_extra_package")) = :VSCodeNotebookServer))
# `Base.include(Main, ...)` rather than `include`, which Julia 1.10 compiles at every start.
Base.include(Main, "../terminalserver/load_vscodeserver.jl")

using InteractiveUtils

# The code lives in VSCodeNotebookServer, where it is precompiled, rather than here, where it would be compiled at every start.
VSCodeNotebookServer.start_notebook_kernel!(Base.ARGS)
