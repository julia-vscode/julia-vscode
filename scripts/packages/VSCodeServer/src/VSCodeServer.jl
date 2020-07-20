module VSCodeServer

export vscodedisplay, @enter, @run
export view_profile, @profview

using REPL, Sockets, Base64, Pkg, UUIDs, Dates, Profile
import Base: display, redisplay

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

module JSONRPC
    import ..JSON
    import UUIDs

    include("../../JSONRPC/src/packagedef.jl")
end

module JuliaInterpreter
    using ..CodeTracking

    include("../../JuliaInterpreter/src/packagedef.jl")
end

module DebugAdapter
    import ..JuliaInterpreter
    import ..JSON
    import ..JSONRPC
    import ..JSONRPC: @dict_readable, Outbound

    include("../../DebugAdapter/src/packagedef.jl")
end

module ChromeProfileFormat
    import ..JSON
    import Profile

    include("../../ChromeProfileFormat/src/core.jl")
end

const conn_endpoint = Ref{Union{Nothing,JSONRPC.JSONRPCEndpoint}}(nothing)

include("../../../error_handler.jl")
include("repl_protocol.jl")
include("misc.jl")
include("trees.jl")
include("repl.jl")
include("gridviewer.jl")
include("module.jl")
include("eval.jl")
include("completions.jl")
include("display.jl")
include("profiler.jl")
include("debugger.jl")

function serve(args...; is_dev=false, crashreporting_pipename::Union{AbstractString,Nothing}=nothing)
    conn = connect(args...)
    conn_endpoint[] = JSONRPC.JSONRPCEndpoint(conn, conn)
    run(conn_endpoint[])

    @async try
        msg_dispatcher = JSONRPC.MsgDispatcher()

        msg_dispatcher[repl_runcode_request_type] = repl_runcode_request
        msg_dispatcher[repl_getvariables_request_type] = repl_getvariables_request
        msg_dispatcher[repl_getlazy_request_type] = repl_getlazy_request
        msg_dispatcher[repl_showingrid_notification_type] = repl_showingrid_notification
        msg_dispatcher[repl_loadedModules_request_type] = repl_loadedModules_request
        msg_dispatcher[repl_isModuleLoaded_request_type] = repl_isModuleLoaded_request
        msg_dispatcher[repl_getcompletions_request_type] = repl_getcompletions_request
        msg_dispatcher[repl_resolvecompletion_request_type] = repl_resolvecompletion_request
        msg_dispatcher[repl_getsignaturehelp_request_type] = repl_getsignaturehelp_request
        msg_dispatcher[repl_startdebugger_notification_type] = (conn, params)->repl_startdebugger_request(conn, params, crashreporting_pipename)

        while true
            msg = JSONRPC.get_next_message(conn_endpoint[])

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
    catch err
        global_err_handler(err, catch_backtrace(), crashreporting_pipename, "REPL")
    end
end

end  # module
