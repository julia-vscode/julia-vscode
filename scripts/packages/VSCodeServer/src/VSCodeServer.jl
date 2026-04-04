module VSCodeServer

export vscodedisplay, @vscodedisplay, @enter, @run
export view_profile, view_profile_allocs, @profview, @profview_allocs

using REPL, Sockets, Base64, Pkg, UUIDs, Dates, Profile
import Base: display, redisplay
import Dates
import Profile
import Logging
import InteractiveUtils

include("../../JSON/src/JSON.jl")
include("../../CancellationTokens/src/CancellationTokens.jl")

@static if VERSION >= v"1.10.0"
    include("../../CodeTracking/src/CodeTracking.jl")
elseif VERSION >= v"1.6.0"
    include("../../../packages-old/v1.9/CodeTracking/src/CodeTracking.jl")
else
    include("../../../packages-old/v1.5/CodeTracking/src/CodeTracking.jl")
end

module IJuliaCore
using ..JSON
using Printf
import Base64

include("../../IJuliaCore/src/packagedef.jl")
end

module JSONRPC
import ..CancellationTokens
import ..JSON
import UUIDs, Sockets

include("../../JSONRPC/src/packagedef.jl")
end

module JuliaInterpreter
using ..CodeTracking

@static if VERSION >= v"1.10.0"
    include("../../JuliaInterpreter/src/packagedef.jl")
elseif VERSION >= v"1.6.0"
    include("../../../packages-old/v1.9/JuliaInterpreter/src/packagedef.jl")
else
    include("../../../packages-old/v1.5/JuliaInterpreter/src/packagedef.jl")
end
end

module DebugAdapter
import Pkg
import ..JuliaInterpreter
import ..JSON

include("../../DebugAdapter/src/packagedef.jl")
end

const FALLBACK_CONSOLE_LOGGER_REF = Ref{Logging.AbstractLogger}()
const DEBUG_SESSION = Ref{Channel{DebugAdapter.DebugSession}}()
const DEBUG_PIPENAME = Ref{String}()

function __init__()
    FALLBACK_CONSOLE_LOGGER_REF[] = Logging.ConsoleLogger()
    DEBUG_SESSION[] = Channel{DebugAdapter.DebugSession}(1)
    atreplinit() do repl
        @async try
            hook_repl(repl)
        catch err
            Base.display_error(err, catch_backtrace())
        end
    end

    push!(Base.package_callbacks, on_pkg_load)

    for pkgid in keys(Base.loaded_modules)
        on_pkg_load(pkgid)
    end

    if VERSION >= v"1.4" && isdefined(InteractiveUtils, :EDITOR_CALLBACKS)
        pushfirst!(InteractiveUtils.EDITOR_CALLBACKS, function (cmd::Cmd, path::AbstractString, line::Integer)
            cmd == `code` || return false
            openfile(path, line)
            return true
        end)
    end
end

const conn_endpoint = Ref{Union{Nothing,JSONRPC.JSONRPCEndpoint}}(nothing)

include("../../../error_handler.jl")
include("repl_protocol.jl")
include("misc.jl")
include("trees.jl")
include("module.jl")
include("progress.jl")
include("eval.jl")
include("completions.jl")
include("repl.jl")
include("./tables/tableviewer.jl")
include("display.jl")
include("profiler.jl")
include("debugger.jl")
include("notebookdisplay.jl")
include("serve_notebook.jl")

is_disconnected_exception(err) = false
is_disconnected_exception(err::InvalidStateException) = err.state === :closed
is_disconnected_exception(err::Base.IOError) = true
# thrown by JSONRPC when the endpoint is not open anymore.
# FIXME: adjust this once JSONRPC throws its own error type
is_disconnected_exception(err::ErrorException) = startswith(err.msg, "Endpoint is not running, the current state is")
is_disconnected_exception(err::CompositeException) = all(is_disconnected_exception, err.exceptions)

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

function serve(conn_pipename, debug_pipename; is_dev=false, error_handler=nothing)
    @debug "start serve" time=round(Int, time()*10)
    conn = connect(conn_pipename)

    @debug "eval backend" time=round(Int, time()*10)
    conn_endpoint[] = JSONRPC.JSONRPCEndpoint(conn, conn)
    if EVAL_BACKEND_TASK[] === nothing
        start_eval_backend()
    end

    start(conn_endpoint[])

    @debug "debug backend" time=round(Int, time()*10)
    DEBUG_PIPENAME[] = debug_pipename
    start_debug_backend(debug_pipename, error_handler)

    @debug "send connected notif" time=round(Int, time()*10)
    JSONRPC.send_notification(conn_endpoint[], "connected", nothing)
    @debug "connected notif sent" time=round(Int, time()*10)

    @async try
        msg_dispatcher = JSONRPC.MsgDispatcher()

        msg_dispatcher[repl_runcode_request_type] = repl_runcode_request
        msg_dispatcher[repl_interrupt_notification_type] = repl_interrupt_notification
        msg_dispatcher[repl_getvariables_request_type] = repl_getvariables_request
        msg_dispatcher[repl_getlazy_request_type] = repl_getlazy_request
        msg_dispatcher[repl_showingrid_notification_type] = repl_showingrid_notification
        msg_dispatcher[repl_loadedModules_request_type] = repl_loadedModules_request
        msg_dispatcher[repl_isModuleLoaded_request_type] = repl_isModuleLoaded_request
        msg_dispatcher[repl_getcompletions_request_type] = repl_getcompletions_request
        msg_dispatcher[repl_resolvecompletion_request_type] = repl_resolvecompletion_request
        msg_dispatcher[repl_toggle_plot_pane_notification_type] = toggle_plot_pane_notification
        msg_dispatcher[repl_toggle_diagnostics_notification_type] = toggle_diagnostics_notification
        msg_dispatcher[repl_toggle_inlay_hints_notification_type] = toggle_inlay_hints_notification
        msg_dispatcher[repl_toggle_progress_notification_type] = toggle_progress_notification
        msg_dispatcher[repl_set_default_plot_mime_notification_type] = set_default_plot_mime_notification
        msg_dispatcher[cd_notification_type] = cd_to_uri_notification
        msg_dispatcher[activate_project_notification_type] = activate_uri_notification
        msg_dispatcher[repl_getdebugitems_request_type] = debugger_getdebugitems_request
        msg_dispatcher[repl_gettabledata_request_type] = get_table_data_request
        msg_dispatcher[repl_clearlazytable_notification_type] = clear_lazy_table_notification

        @debug "send queued notifs" time=round(Int, time()*10)
        send_queued_notifications!()

        @debug "entering message loop" time=round(Int, time()*10)
        @sync while conn_endpoint[] isa JSONRPC.JSONRPCEndpoint && isopen(conn)
            msg = JSONRPC.get_next_message(conn_endpoint[])
            @debug "message: $(msg.method)" time=round(Int, time()*10)

            if msg.method == repl_runcode_request_type.method
                @async try
                    dispatch_msg(conn_endpoint, msg_dispatcher, msg, is_dev)
                catch err
                    if error_handler===nothing
                        Base.display_error(err, catch_backtrace())
                    else
                        error_handler(err, catch_backtrace())
                    end
                end
            else
                dispatch_msg(conn_endpoint, msg_dispatcher, msg, is_dev)
            end
            yield()
            @debug "message: $(msg.method) done" time=round(Int, time()*10)
        end
    catch err
        if is_disconnected_exception(err)
            println(stderr, "\n\n\x1b[30;41m * \x1b[0m Lost connection to the editor. You can use the 'Julia: Connect External REPL' command to reconnect. \x1b[30;41m * \x1b[0m\n\n")
        else
            try
                error_handler(err, catch_backtrace())
            catch err
                @error "Error handler threw an error." exception = (err, catch_backtrace())
            end
        end
    finally
        @debug "JSONRPC dispatcher task finished"
    end
    yield()
    return
end

function _precompile_()
    ccall(:jl_generating_output, Cint, ()) == 1 || return nothing

    precompile(hook_repl, (REPL.LineEditREPL,))
    precompile(serve, (String, String,))
    precompile(send_queued_notifications!, ())
    precompile(is_module_loaded, (String,))
    precompile(start_debug_backend, (String,Nothing))

    # run an actual workload
    in_pipe = Pipe()
    out_pipe = Pipe()
    Base.link_pipe!(in_pipe)
    Base.link_pipe!(out_pipe)
    reader_task = @async while isopen(out_pipe.out)
        readavailable(out_pipe.out)
    end
    e = JSONRPC.JSONRPCEndpoint(in_pipe.out, out_pipe.in)
    start(e)
    JSONRPC.send_notification(e, "connected", nothing)
    JSONRPC.send_error_response(e, JSONRPC.Request("", nothing, 1, nothing), 99999, "", nothing)
    md = JSONRPC.MsgDispatcher()
    md[repl_isModuleLoaded_request_type] = repl_isModuleLoaded_request
    dispatch_msg(Ref(e), md, JSONRPC.Request("repl/isModuleLoaded", Dict{String,Any}("mod" => "Base"), 1, nothing), false)
    close(e)
    close(in_pipe.in)
    close(out_pipe.out)
    wait(reader_task)

    is_module_loaded("Base")

    # and then precompile all of the request handlers
    E = typeof(e)
    precompile(repl_runcode_request, (E, ReplRunCodeRequestParams, Nothing))
    precompile(repl_getvariables_request, (E, NamedTuple{(:modules,),Tuple{Bool}}, Nothing))
    precompile(repl_getlazy_request, (E, NamedTuple{(:id,),Tuple{Int}}, Nothing))
    precompile(repl_loadedModules_request, (E, Nothing, Nothing))
    precompile(repl_isModuleLoaded_request, (E, NamedTuple{(:mod,),Tuple{String}}, Nothing))
    precompile(repl_getcompletions_request, (E, GetCompletionsRequestParams, Nothing))
    precompile(repl_resolvecompletion_request, (E, Dict, Nothing))
    precompile(debugger_getdebugitems_request, (E, NamedTuple{(:juliaAccessor,),Tuple{String}}, Nothing))
    precompile(get_table_data_request, (E, GetTableDataRequest, Nothing))

    precompile(repl_interrupt_notification, (E, Nothing))
    precompile(repl_showingrid_notification, (E, NamedTuple{(:code,),Tuple{String}}))
    precompile(toggle_plot_pane_notification, (E, NamedTuple{(:enable,),Tuple{Bool}}))
    precompile(toggle_diagnostics_notification, (E, NamedTuple{(:enable,),Tuple{Bool}}))
    precompile(toggle_inlay_hints_notification, (E, NamedTuple{(:enable,),Tuple{Bool}}))
    precompile(toggle_progress_notification, (E, NamedTuple{(:enable,),Tuple{Bool}}))
    precompile(set_default_plot_mime_notification, (E, NamedTuple{(:mime,),Tuple{String}}))
    precompile(cd_to_uri_notification, (E, NamedTuple{(:uri,),Tuple{String}}))
    precompile(activate_uri_notification, (E, NamedTuple{(:uri,),Tuple{String}}))
    precompile(clear_lazy_table_notification, (E, NamedTuple{(:id,),Tuple{String}}))

    precompile(JSONRPC.dispatch_msg, (E, JSONRPC.MsgDispatcher, JSONRPC.Request))
    precompile(JSONRPC.get_next_message, (E,))
end

_precompile_()

end  # module
