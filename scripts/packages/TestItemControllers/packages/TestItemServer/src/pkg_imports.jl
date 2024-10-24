include("../../../../TestEnv/src/TestEnv.jl")
include("../../../../URIParser/src/URIParser.jl")
include("../../../../JSON/src/JSON.jl")
include("../../../../OrderedCollections/src/OrderedCollections.jl")
include("../../../../CodeTracking/src/CodeTracking.jl")
include("../../../../CoverageTools/src/CoverageTools.jl")
include(joinpath(homedir(), ".julia/dev/IOCapture/src/IOCapture.jl"))

module JSONRPC
import ..JSON
import UUIDs
include("../../../../JSONRPC/src/packagedef.jl")
end

module JuliaInterpreter
    using ..CodeTracking

    @static if VERSION >= v"1.6.0"
        include("../../../../JuliaInterpreter/src/packagedef.jl")
    else
        include("../../../../../packages-old/v1.5/JuliaInterpreter/src/packagedef.jl")
    end
end

module LoweredCodeUtils
    using ..JuliaInterpreter
    using ..JuliaInterpreter: SSAValue, SlotNumber, Frame
    using ..JuliaInterpreter: @lookup, moduleof, pc_expr, step_expr!, is_global_ref, is_quotenode_egal, whichtt,
        next_until!, finish_and_return!, get_return, nstatements, codelocation, linetable,
        is_return, lookup_return

    @static if VERSION >= v"1.6.0"
        include("../../../../LoweredCodeUtils/src/packagedef.jl")
    else
        include("../../../../../packages-old/v1.5/LoweredCodeUtils/src/packagedef.jl")
    end
end

module Revise
    using ..OrderedCollections
    using ..LoweredCodeUtils
    using ..CodeTracking
    using ..JuliaInterpreter
    using ..CodeTracking: PkgFiles, basedir, srcfiles, line_is_decl, basepath
    using ..JuliaInterpreter: whichtt, is_doc_expr, step_expr!, finish_and_return!, get_return,
        @lookup, moduleof, scopeof, pc_expr, is_quotenode_egal,
        linetable, codelocs, LineTypes, isassign, isidentical
    using ..LoweredCodeUtils: next_or_nothing!, trackedheads, callee_matches
    @static if VERSION >= v"1.6.0"
        include("../../../../Revise/src/packagedef.jl")
    else
        include("../../../../../packages-old/v1.5/Revise/src/packagedef.jl")
    end
end

module DebugAdapter
    import Pkg
    import ..JuliaInterpreter
    import ..JSON

    include("../../../../DebugAdapter/src/packagedef.jl")
end
