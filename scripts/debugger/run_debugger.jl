# ENV["JULIA_DEBUG"] = "all"

pushfirst!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))
try
    import VSCodeDebugger
finally
    popfirst!(LOAD_PATH)
end

Base.load_julia_startup()

VSCodeDebugger.startdebugger()
