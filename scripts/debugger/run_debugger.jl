# ENV["JULIA_DEBUG"] = "all"

pushfirst!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
import VSCodeDebugger
popfirst!(LOAD_PATH)

Base.load_julia_startup()

printstyled("> Debugging...\n\n", bold = true)

VSCodeDebugger.startdebugger()
