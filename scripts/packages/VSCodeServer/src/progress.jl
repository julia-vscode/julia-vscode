struct VSCodeLogger <: Logging.AbstractLogger
    parent::Union{Nothing, Logging.AbstractLogger}
end
VSCodeLogger() = VSCodeLogger(nothing)

const logger_lock = ReentrantLock()
function Logging.handle_message(j::VSCodeLogger, level, message, _module,
    group, id, file, line; kwargs...)
    isprogress = try_process_progress(level, message, _module, group, id, file, line; kwargs...) do progress
        lock(logger_lock)
        try
            JSONRPC.send_notification(conn_endpoint[], "repl/updateProgress", progress)
            JSONRPC.flush(conn_endpoint[])
        catch err
            @debug "Failed to send 'repl/updateProgress' message" exception=(err, catch_backtrace())
            return nothing
        finally
            unlock(logger_lock)
        end
    end isa Some

    if isprogress
        return nothing
    end

    previous_logger = get_previous_logger(j)

    # Pass through non-progress log messages to the global logger iff the global logger would handle it:
    if (Base.invokelatest(Logging.min_enabled_level, previous_logger) <= Logging.LogLevel(level) ||
        Base.CoreLogging.env_override_minlevel(group, _module)) &&
       Base.invokelatest(Logging.shouldlog, previous_logger, level, _module, group, id)
        Logging.handle_message(previous_logger, level, message, _module,
            group, id, file, line; kwargs...)
    end
    return nothing
end

Logging.shouldlog(::VSCodeLogger, level, _module, group, id) = true

Logging.catch_exceptions(::VSCodeLogger) = true

function Logging.min_enabled_level(j::VSCodeLogger)
    min(Base.invokelatest(Logging.min_enabled_level, get_previous_logger(j)), Logging.LogLevel(-1))
end

prevent_logger_recursion(l) = l
function prevent_logger_recursion(::VSCodeLogger)
    l = FALLBACK_CONSOLE_LOGGER_REF[]
    Logging.with_logger(l) do
        @warn "Infinite recursion detected in logger setup. `VSCodeServer.VSCodeLogger` may not be used as a global logger!" _id=:vslogrecwarn maxlog=1
    end
    return l
end
get_previous_logger(j::VSCodeLogger) = prevent_logger_recursion(something(j.parent, Logging.global_logger()))

const progresslogging_pkgid = Base.PkgId(
    Base.UUID("33c8b6b6-d38a-422a-b730-caa89a2f386c"),
    "ProgressLogging"
)

"""
    try_process_progress(f, args...; kwargs...) -> nothing or Some(ans)

Try to process logging record by a function `f(::Progress) -> ans`.  Arguments
`args` and `kwargs` are the ones passed to ```Logging.handle_message`.  Return
`Some(ans)` if it is a progress record.
"""
function try_process_progress(f, args...; kwargs...)
    m = get(Base.loaded_modules, progresslogging_pkgid, nothing)
    m === nothing && return nothing
    isdefined(m, :asprogress) || return nothing
    Base.invokelatest() do
        progress = m.asprogress(args...; kwargs...)
        progress === nothing && return nothing
        return Some(f(progress))
    end
end
