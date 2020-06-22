module VSCodeDebugger

include("../../CodeTracking/src/CodeTracking.jl")
include("../../JSON/src/JSON.jl")

module JuliaInterpreter
    using ..CodeTracking

    include("../../JuliaInterpreter/src/packagedef.jl")
end

module JSONRPC
    import ..JSON
    import UUIDs

    include("../../JSONRPC/src/packagedef.jl")
end

module DebugAdapter
    import ..JuliaInterpreter
    import ..JSON
    import ..JSONRPC
    import ..JSONRPC: @dict_readable, Outbound

    include("../../DebugAdapter2/src/packagedef.jl")
end

end
