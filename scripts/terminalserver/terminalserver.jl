# this script loads VSCodeServer and handles ARGS
# The code lives in VSCodeServer, where it is precompiled, rather than here, where it would be compiled at every start.
# `Base.include(Main, ...)` rather than `include`, which Julia 1.10 compiles at every start.
Base.include(Main, "load_vscodeserver.jl")
VSCodeServer.start_terminalserver!(Base.ARGS)
