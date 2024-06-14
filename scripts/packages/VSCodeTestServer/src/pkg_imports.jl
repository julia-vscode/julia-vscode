include("../../TestEnv/src/TestEnv.jl")
include("../../URIParser/src/URIParser.jl")
include("../../JSON/src/JSON.jl")
include("../../OrderedCollections/src/OrderedCollections.jl")
include("../../CodeTracking/src/CodeTracking.jl")

module JSONRPC
import ..JSON
import UUIDs
include("../../JSONRPC/src/packagedef.jl")
end

module JuliaInterpreter
using ..CodeTracking
include("../../JuliaInterpreter/src/packagedef.jl")
end

module LoweredCodeUtils
using ..JuliaInterpreter
using ..JuliaInterpreter: SSAValue, SlotNumber, Frame
using ..JuliaInterpreter: @lookup, moduleof, pc_expr, step_expr!, is_global_ref, is_quotenode_egal, whichtt,
    next_until!, finish_and_return!, get_return, nstatements, codelocation, linetable,
    is_return, lookup_return

include("../../LoweredCodeUtils/src/packagedef.jl")
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
include("../../Revise/src/packagedef.jl")
end

module DebugAdapater
    import Pkg
    import ..JuliaInterpreter
    import ..JSON

    include("../../DebugAdapter/src/packagedef.jl")
end
