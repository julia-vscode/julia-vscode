struct VSCodeLogger <: Logging.AbstractLogger end

function Logging.handle_message(j::VSCodeLogger, level, message, _module,
                                group, id, file, line; kwargs...)
    progress = ProgressLogging.asprogress(level, message, _module, group, id, file, line; kwargs...)
    if progress !== nothing
        JSONRPC.send_notification(conn_endpoint[], "repl/updateProgress", progress)
    else
        previous_logger = Logging.global_logger()
        # Pass through non-progress log messages to the global logger iff the global logger would handle it:
        if (Base.invokelatest(Logging.min_enabled_level, previous_logger) <= Logging.LogLevel(level) ||
            Base.CoreLogging.env_override_minlevel(group, _module)) &&
            Base.invokelatest(Logging.shouldlog, previous_logger, level, _module, group, id)
            Logging.handle_message(previous_logger, level, message, _module,
                            group, id, file, line; kwargs...)
        end
    end
    return nothing
end

Logging.shouldlog(::VSCodeLogger, level, _module, group, id) = true

Logging.catch_exceptions(::VSCodeLogger) = true

function Logging.min_enabled_level(::VSCodeLogger)
    min(Base.invokelatest(Logging.min_enabled_level, Logging.global_logger()), Logging.LogLevel(-1))
end
