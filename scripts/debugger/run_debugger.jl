# ENV["JULIA_DEBUG"] = "all"

Base.push!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
import VSCodeDebugger
pop!(LOAD_PATH)

VSCodeDebugger.startdebugger()
