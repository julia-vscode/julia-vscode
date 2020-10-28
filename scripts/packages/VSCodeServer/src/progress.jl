struct VSCodeLogger <: Logging.AbstractLogger end

function Logging.handle_message(j::VSCodeLogger, level, message, _module,
                                group, id, file, line; kwargs...)
    isprogress = try_process_progress(level, message, _module, group, id, file, line; kwargs...) do progress
        JSONRPC.send_notification(conn_endpoint[], "repl/updateProgress", progress)
    end isa Some

    if isprogress
        return nothing
    end

    previous_logger = Logging.global_logger()
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

function Logging.min_enabled_level(::VSCodeLogger)
    min(Base.invokelatest(Logging.min_enabled_level, Logging.global_logger()), Logging.LogLevel(-1))
end

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
