# ENV["JULIA_DEBUG"] = "all"

pushfirst!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
import VSCodeDebugger
popfirst!(LOAD_PATH)

VSCodeDebugger.startdebugger()
