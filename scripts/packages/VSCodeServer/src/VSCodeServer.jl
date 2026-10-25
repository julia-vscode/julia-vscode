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

# Set to `true` when the server is started in development mode; gates `@_debug`.
const IS_DEV = Ref(false)

# Like `@debug`, but only emits when the server runs in development mode.
macro _debug(exs...)
    logcall = Expr(:macrocall, GlobalRef(Base, Symbol("@debug")), __source__, exs...)
    quote
        if IS_DEV[]
            $(esc(logcall))
        end
    end
end

"""
    BoundCall(f, args...)

Create a function that calls `f(args..., more...)` when it is called with `more...`.

Use it instead of a closure for the tasks and REPL callbacks that run at every start, for
example `schedule(Task(BoundCall(f, args...)))` instead of `@async f(args...)`.
All `BoundCall`s have the same type and do not specialize on `args` or `more`, so their
call method is compiled once and precompiled. A closure has a type that depends on the
types of the values it captures. Before Julia 1.13 this holds even for `@nospecialize`
arguments, so such a closure is compiled anew for, e.g., every type of error handler.

```jldoctest
julia> VSCodeServer.BoundCall(+, 1, 2)()
3

julia> VSCodeServer.BoundCall(string, "a")(:b, 'c')
"abc"
```
"""
struct BoundCall <: Function
    f::Any
    args::Tuple
    BoundCall(@nospecialize(f), @nospecialize(args...)) = new(f, args)
end

(call::BoundCall)(@nospecialize(more...)) = call.f(call.args..., more...)

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
is_disconnected_exception(err::ErrorException) = startswith(err.msg, "Endpoint is not running, the current state is")
is_disconnected_exception(err::CompositeException) = all(is_disconnected_exception, err.exceptions)
is_disconnected_exception(err::JSONRPC.TransportError) = true
is_disconnected_exception(err::JSONRPC.JSONRPCError) = true
is_disconnected_exception(err::JSONRPC.CancellationTokens.OperationCanceledException) = true

"""
    is_user_interrupt(err)

Whether `err` is the user interrupting rather than anything going wrong.

Ctrl+C in the REPL, and the `InterruptException` that `repl/interrupt`
schedules into the eval backend, can both land in the serve loop's error
handling. Neither is a crash: the report carries only the stack of whatever
task the interrupt happened to hit, which says nothing about a defect.

The `@sync` in the message loop wraps a failing child task, so the wrappers
are unwrapped here as well.
"""
is_user_interrupt(err) = false
is_user_interrupt(err::InterruptException) = true
is_user_interrupt(err::CompositeException) = !isempty(err.exceptions) && all(is_user_interrupt, err.exceptions)
@static if isdefined(Base, :TaskFailedException)
    is_user_interrupt(err::Base.TaskFailedException) = is_user_interrupt(err.task.result)
end

# The crash-reporting callback passed to `serve`, kept in a global so that code
# running outside the message-dispatch path (the REPL hook, the REPL eval entry
# points) can report internal errors too.
const ERROR_HANDLER = Ref{Union{Nothing,Function}}(nothing)

"""
    report_internal_error(err, bt)

Send an internal error to crash reporting without terminating the REPL process.
Disconnects are expected teardown and are not reported, and neither is the user
interrupting. Errors raised by user code must never be routed here — this is
for bugs in VSCodeServer itself.
"""
function report_internal_error(err, bt)
    is_disconnected_exception(err) && return
    is_user_interrupt(err) && return
    handler = ERROR_HANDLER[]
    handler === nothing && return
    try
        handler(err, bt; should_exit=false)
    catch err2
        @error "Error handler threw an error." exception = (err2, catch_backtrace())
    end
    return
end

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

function handle_serve_error(err, bt, error_handler)
    if is_disconnected_exception(err)
        println(
            stderr,
            "\n\n\x1b[30;41m * \x1b[0m Lost connection to the editor. You can use the 'Julia: Connect External REPL' command to reconnect. \x1b[30;41m * \x1b[0m\n\n"
        )
    elseif is_user_interrupt(err)
        # The user asked for this; there is nothing to report and nothing to say.
    elseif error_handler === nothing
        Base.display_error(err, bt)
    else
        try
            error_handler(err, bt; should_exit=false)
        catch err
            @error "Error handler threw an error." exception = (err, catch_backtrace())
        end
    end
end

function serve(conn_pipename, debug_pipename; is_dev=false, @nospecialize(error_handler=nothing))
    IS_DEV[] = is_dev
    ERROR_HANDLER[] = error_handler::Union{Nothing,Function}
    @_debug "start serve" time=round(Int, time()*10)

    if isdefined(Base, :active_repl)
        try_hook_repl(Base.active_repl)
    else
        atreplinit(try_hook_repl)
    end

    @_debug "connect to pipe" time=round(Int, time()*10)
    conn = connect(conn_pipename)

    @_debug "eval backend" time=round(Int, time()*10)
    conn_endpoint[] = JSONRPC.JSONRPCEndpoint(conn, conn)
    if EVAL_BACKEND_TASK[] === nothing
        start_eval_backend()
    end

    JSONRPC.start(conn_endpoint[])

    @_debug "debug backend" time=round(Int, time()*10)
    DEBUG_PIPENAME[] = debug_pipename
    start_debug_backend(debug_pipename, error_handler)

    @_debug "send connected notif" time=round(Int, time()*10)
    JSONRPC.send_notification(conn_endpoint[], "connected", nothing)
    @_debug "connected notif sent" time=round(Int, time()*10)

    schedule(Task(BoundCall(serve_messages, conn, is_dev, error_handler)))
    yield()
    return
end

"""
    serve_messages(conn, is_dev, error_handler)

Dispatch the messages from the VS Code extension until the connection `conn` closes.

Setting `conn_endpoint[]` to `nothing` stops the loop as well. Errors go to
`handle_serve_error`, unless `conn_endpoint[]` is `nothing` by then.
"""
function serve_messages(conn, is_dev, @nospecialize(error_handler))
    try
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

        @_debug "send queued notifs" time=round(Int, time()*10)
        send_queued_notifications!()

        @_debug "entering message loop" time=round(Int, time()*10)
        @sync while conn_endpoint[] isa JSONRPC.JSONRPCEndpoint && isopen(conn)
            msg = JSONRPC.get_next_message(conn_endpoint[])
            @_debug "message: $(msg.method)" time=round(Int, time()*10)

            if msg.method == repl_runcode_request_type.method
                @async try
                    dispatch_msg(conn_endpoint, msg_dispatcher, msg, is_dev)
                catch err
                    handle_serve_error(err, catch_backtrace(), error_handler)
                end
            else
                dispatch_msg(conn_endpoint, msg_dispatcher, msg, is_dev)
            end
            yield()
            @_debug "message: $(msg.method) done" time=round(Int, time()*10)
        end
    catch err
        isnothing(conn_endpoint[]) || handle_serve_error(err, catch_backtrace(), error_handler)
    finally
        @_debug "JSONRPC dispatcher task finished"
    end
end

"""
    start_terminalserver!(args::Vector{String})

Remove the arguments of `terminalserver.jl` from the front of `args`, apply them and start [`serve`](@ref).

The VS Code extension passes nine arguments: the pipe names for the connection, the debugger
and crash reporting, followed by the settings `USE_REVISE`, `USE_PLOTPANE`, `USE_PROGRESS`,
`ENABLE_SHELL_INTEGRATION`, `DEBUG_MODE` and `PLOTS_DEFAULT_MIME` as `NAME=value`.
`USE_REVISE=true` loads Revise into `Main`. If Revise is not installed, VS Code is told so and
offers to install it. Other errors while loading Revise are logged.
"""
function start_terminalserver!(args::Vector{String})
    @debug "vscodeserver loaded" time=round(Int, time()*10)
    server_args = splice!(args, 1:9)
    conn_pipename, debug_pipename, telemetry_pipename = server_args[1:3]
    has_revise = true

    if "USE_REVISE=true" in server_args
        try
            Core.eval(Main, :(using Revise))
            @static if VERSION < v"1.5"
                Core.eval(Main, :(Revise.async_steal_repl_backend()))
            end
        catch err
            # `using` throws an `ArgumentError` for a package that is not installed. Other errors
            # are logged rather than rethrown, so that the REPL still connects to VS Code.
            if err isa ArgumentError
                has_revise = false
            else
                @error "Revise failed to load" exception = (err, catch_backtrace())
            end
        end
    end

    @debug "revise check done" time=round(Int, time()*10)

    if !Sys.iswindows() && "ENABLE_SHELL_INTEGRATION=true" in server_args
        ENABLE_SHELL_INTEGRATION[] = true
    end

    # set default plot mime before atreplinit
    for arg in server_args
        if startswith(arg, "PLOTS_DEFAULT_MIME=")
            mime = split(arg, "=", limit=2)[2]
            set_default_plot_mime_notification(nothing, (;mime=string(mime)))
            break
        end
    end
    toggle_plot_pane_notification(nothing, (;enable="USE_PLOTPANE=true" in server_args))
    toggle_progress_notification(nothing, (;enable="USE_PROGRESS=true" in server_args))

    @debug "settings done" time=round(Int, time()*10)

    serve(
        conn_pipename,
        debug_pipename;
        is_dev="DEBUG_MODE=true" in server_args,
        error_handler = (err, bt; should_exit=true) -> global_err_handler(err, bt, telemetry_pipename, "REPL"; should_exit = should_exit)
    )

    @debug "serve done" time=round(Int, time()*10)
    if !has_revise
        JSONRPC.send_notification(conn_endpoint[], "norevise", has_revise)
    end
    @debug "all done" time=round(Int, time()*10)
    return
end

"""
    precompile_serve()

Run [`serve`](@ref) against a stand-in for the VS Code extension and stop it again.

The stand-in accepts the connection and sends one request, so that the message loop runs.
The debug pipe name is taken already, so the `listen` of the debug backend fails and goes to
the error handler. The eval backend does not start, because its loop never returns.
Afterwards, the globals that `serve` sets hold their initial values again, except for
`DEBUG_PIPENAME`, which `serve` always sets before its use.
"""
function precompile_serve()
    conn_pipename = JSONRPC.generate_pipe_name()
    debug_pipename = JSONRPC.generate_pipe_name()
    extension = Sockets.listen(conn_pipename)
    debug_blocker = Sockets.listen(debug_pipename)
    reported_errors = Channel{Any}(Inf)
    client = nothing
    EVAL_BACKEND_TASK[] = current_task()
    try
        client_task = @async begin
            socket = accept(extension)
            endpoint = JSONRPC.JSONRPCEndpoint(socket, socket)
            JSONRPC.start(endpoint)
            JSONRPC.send(endpoint, repl_isModuleLoaded_request_type, (mod = "Base",))
            endpoint
        end
        serve(conn_pipename, debug_pipename; error_handler = (err, bt; should_exit=true) -> put!(reported_errors, err))
        client = fetch(client_task)
        err = take!(reported_errors)
        err isa ArgumentError || throw(err)
    finally
        server = conn_endpoint[]
        conn_endpoint[] = nothing
        for endpoint in (client, server)
            endpoint === nothing && continue
            close(endpoint)
            close(endpoint.pipe_in)
        end
        EVAL_BACKEND_TASK[] = nothing
        ERROR_HANDLER[] = nothing
        IS_DEV[] = false
        close(extension)
        close(debug_blocker)
        if !Sys.iswindows()
            rm(conn_pipename; force=true)
            rm(debug_pipename; force=true)
        end
    end
    return
end

"""
    precompile_shell_integration()

Add the shell integration to a stand-in REPL prompt and call its functions as the REPL does.

They print nothing, because the shell integration is off during precompilation.
"""
function precompile_shell_integration()
    prompt = LineEdit.Prompt("julia> "; prompt_prefix = "", prompt_suffix = "", on_done = (s, buf, ok) -> nothing)
    add_shell_integration!(prompt)
    LineEdit.prompt_string(prompt.prompt_prefix)
    LineEdit.prompt_string(prompt.prompt_suffix)
    prompt.on_done(nothing, IOBuffer(), true)
    REPL_PROMPT_STATE[] = REPLPromptStates.NoUpdate
    return
end

function precompile_workload()
    precompile(hook_repl, (REPL.LineEditREPL,))
    precompile(serve, (String, String,))
    precompile(send_queued_notifications!, ())
    precompile(is_module_loaded, (String,))
    precompile(start_debug_backend, (String,Nothing))

    # These run when a REPL starts, with its `LineEditREPL`. The workloads below start no REPL,
    # so they cannot call them.
    precompile(try_hook_repl, (REPL.LineEditREPL,))
    precompile(hook_repl_or_report, (REPL.LineEditREPL,))
    precompile(get_main_mode, (REPL.LineEditREPL,))
    # `connect` in `serve` calls this by runtime dispatch. Package images keep native code from Julia
    # 1.9 on. From 1.12 on, the function is gone, and the tagging in `_precompile_` covers `connect`.
    @static if v"1.9" <= VERSION < v"1.12"
        precompile(Sockets.uv_connectcb, (Ptr{Nothing}, Int32))
    end
    # `precompile_serve` neither starts the eval backend nor uses the crash reporting handler,
    # which exits the process.
    precompile(eval_backend, ())
    precompile(start_terminalserver!, (Vector{String},))

    # The first evaluation runs user code in `Main` and shows its result in the REPL, which
    # the workloads below cannot do.
    precompile(ReplRunCodeRequestParams, (Dict{String,Any},))
    precompile(display, (InlineDisplay, Any))
    # `hideprompt` restores the prompt with these.
    precompile(has_parent_prompt, (LineEdit.Prompt,))
    @static if isdefined(Core, :kwcall)
        precompile(Core.kwcall, (NamedTuple{(:color, :bold),Tuple{Symbol,Bool}}, typeof(printstyled), Base.TTY, String))
    end
    @static if VERSION >= v"1.5"
        precompile(include_string, (typeof(REPL.softscope), Module, String, String))
    end

    # run an actual workload
    in_pipe = Pipe()
    out_pipe = Pipe()
    Base.link_pipe!(in_pipe)
    Base.link_pipe!(out_pipe)
    reader_task = @async while isopen(out_pipe.out)
        readavailable(out_pipe.out)
    end
    e = JSONRPC.JSONRPCEndpoint(in_pipe.out, out_pipe.in)
    JSONRPC.start(e)
    JSONRPC.send_notification(e, "connected", nothing)
    JSONRPC.send_error_response(e, JSONRPC.Request("", nothing, 1, nothing), 99999, "", nothing)
    md = JSONRPC.MsgDispatcher()
    md[repl_isModuleLoaded_request_type] = repl_isModuleLoaded_request
    dispatch_msg(Ref(e), md, JSONRPC.Request("repl/isModuleLoaded", Dict{String,Any}("mod" => "Base"), 1, nothing), false)

    # After the first evaluation, the extension gets its result and refreshes the workspace view.
    for x in (1, 1.5, "text", [1.0, 2.0, 3.0], [1.0 2.0; 3.0 4.0], nothing)
        JSONRPC.send_success_response(e, JSONRPC.Request("repl/runcode", nothing, 1, nothing), safe_render(x))
        treerender(SubTree("x", wsicon(x), x))
        can_display(x)
    end
    md[repl_getvariables_request_type] = repl_getvariables_request
    dispatch_msg(Ref(e), md, JSONRPC.Request("repl/getvariables", Dict{String,Any}("modules" => true), 1, nothing), false)
    clear_lazy()

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

    precompile_serve()
    precompile_shell_integration()
end

function _precompile_()
    ccall(:jl_generating_output, Cint, ()) == 1 || return nothing

    # Save everything that the workload infers, including Base methods that it calls by
    # runtime dispatch, as PrecompileTools does on Julia 1.12 and later.
    @static if VERSION >= v"1.12"
        ccall(:jl_tag_newly_inferred_enable, Cvoid, ())
    end
    try
        precompile_workload()
    finally
        @static if VERSION >= v"1.12"
            ccall(:jl_tag_newly_inferred_disable, Cvoid, ())
        end
    end
end

_precompile_()

end  # module
