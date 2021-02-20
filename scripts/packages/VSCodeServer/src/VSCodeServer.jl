module VSCodeServer

export vscodedisplay, @enter, @run
export view_profile, @profview

using REPL, Sockets, Base64, Pkg, UUIDs
import Base: display, redisplay
import Dates
import Profile
import Logging

function __init__()
    atreplinit() do repl
        @async try
            hook_repl(repl)
        catch err
            Base.display_error(err, catch_backtrace())
        end
    end

    push!(Base.package_callbacks, pkgload)
end

include("../../JSON/src/JSON.jl")
include("../../CodeTracking/src/CodeTracking.jl")
include("../../OrderedCollections/src/OrderedCollections.jl")

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
    using ..JuliaInterpreter: @lookup, moduleof, pc_expr, step_expr!, is_global_ref, whichtt,
                        next_until!, finish_and_return!, nstatements, codelocation,
                        is_return, lookup_return, is_GotoIfNot, is_ReturnNode

    include("../../LoweredCodeUtils/src/packagedef.jl")
end

module DebugAdapter
    import ..JuliaInterpreter
    import ..JSON
    import ..JSONRPC
    import ..JSONRPC: @dict_readable, Outbound

    include("../../DebugAdapter/src/packagedef.jl")
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

using .Revise:includet

export includet

module ChromeProfileFormat
    import ..JSON
    import Profile

    include("../../ChromeProfileFormat/src/core.jl")
end

const conn_endpoint = Ref{Union{Nothing,JSONRPC.JSONRPCEndpoint}}(nothing)
const g_use_revise = Ref{Bool}(false)

include("../../../error_handler.jl")
include("repl_protocol.jl")
include("misc.jl")
include("trees.jl")
include("repl.jl")
include("gridviewer.jl")
include("module.jl")
include("progress.jl")
include("eval.jl")
include("display.jl")
include("profiler.jl")
include("debugger.jl")

function dispatch_msg(conn_endpoint, msg_dispatcher, msg, is_dev)
    if is_dev
        try
            JSONRPC.dispatch_msg(conn_endpoint[], msg_dispatcher, msg)
        catch err
            Base.display_error(err, catch_backtrace())
        end
    else
        JSONRPC.dispatch_msg(conn_endpoint[], msg_dispatcher, msg)
    end
end

function serve(args...; is_dev=false, crashreporting_pipename::Union{AbstractString,Nothing}=nothing)
    conn = connect(args...)
    conn_endpoint[] = JSONRPC.JSONRPCEndpoint(conn, conn)
    start_eval_backend()
    run(conn_endpoint[])

    @async try
        msg_dispatcher = JSONRPC.MsgDispatcher()

        msg_dispatcher[repl_runcode_request_type] = repl_runcode_request
        msg_dispatcher[repl_interrupt_notification_type] = repl_interrupt_request
        msg_dispatcher[repl_getvariables_request_type] = repl_getvariables_request
        msg_dispatcher[repl_getlazy_request_type] = repl_getlazy_request
        msg_dispatcher[repl_showingrid_notification_type] = repl_showingrid_notification
        msg_dispatcher[repl_loadedModules_request_type] = repl_loadedModules_request
        msg_dispatcher[repl_isModuleLoaded_request_type] = repl_isModuleLoaded_request
        msg_dispatcher[repl_startdebugger_notification_type] = (conn, params) -> repl_startdebugger_request(conn, params, crashreporting_pipename)
        msg_dispatcher[repl_toggle_plot_pane_notification_type] = toggle_plot_pane
        msg_dispatcher[repl_toggle_progress_notification_type] = toggle_progress
        msg_dispatcher[cd_notification_type] = cd_to_uri
        msg_dispatcher[activate_project_notification_type] = activate_uri

        while true
            msg = JSONRPC.get_next_message(conn_endpoint[])

            if msg["method"] == repl_runcode_request_type.method
                @async dispatch_msg(conn_endpoint, msg_dispatcher, msg, is_dev)
            else
                dispatch_msg(conn_endpoint, msg_dispatcher, msg, is_dev)
            end
        end
    catch err
        global_err_handler(err, catch_backtrace(), crashreporting_pipename, "REPL")
    end
end

end  # module
