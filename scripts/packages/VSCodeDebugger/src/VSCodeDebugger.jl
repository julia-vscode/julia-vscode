module VSCodeDebugger

include("../../CodeTracking/src/CodeTracking.jl")

module JuliaInterpreter
    using ..CodeTracking

    include("../../JuliaInterpreter/src/packagedef.jl")
end

module DebugAdapter
    import ..JuliaInterpreter

    include("../../DebugAdapter/src/packagedef.jl")
end

end
