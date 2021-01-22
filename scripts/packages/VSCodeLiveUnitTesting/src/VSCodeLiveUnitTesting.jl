module VSCodeLiveUnitTesting

include("../../OrderedCollections/src/OrderedCollections.jl")
include("../../CodeTracking/src/CodeTracking.jl")

module JuliaInterpreter
    using ..CodeTracking

    include("../../JuliaInterpreter/src/packagedef.jl")
end

module LoweredCodeUtils
    using ..JuliaInterpreter
    using ..JuliaInterpreter: SSAValue, SlotNumber, Frame
    using ..JuliaInterpreter: @lookup, moduleof, pc_expr, step_expr!, is_global_ref, whichtt,
                        next_until!, finish_and_return!, nstatements, codelocation,
                        is_return, lookup_return, is_GotoIfNot, is_ReturnNode

    include("../../LoweredCodeUtils/src/packagedef.jl")
end

module Revise
    using ..OrderedCollections
    using ..CodeTracking
    using ..JuliaInterpreter
    using ..LoweredCodeUtils

    using ..CodeTracking: PkgFiles, basedir, srcfiles, line_is_decl, basepath
    using ..JuliaInterpreter: whichtt, is_doc_expr, step_expr!, finish_and_return!, get_return,
                        @lookup, moduleof, scopeof, pc_expr, is_quotenode_egal,
                        linetable, codelocs, LineTypes, is_GotoIfNot, isassign, isidentical
    using ..LoweredCodeUtils: next_or_nothing!, trackedheads, structheads, callee_matches

    include("../../Revise/src/packagedef.jl")
end

end
