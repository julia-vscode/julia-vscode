# ENV["JULIA_DEBUG"] = "all"
print("> Connecting to debugger... ")

pushfirst!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
import VSCodeDebugger
popfirst!(LOAD_PATH)

Base.load_julia_startup()

VSCodeDebugger.startdebugger()
