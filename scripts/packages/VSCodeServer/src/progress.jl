struct VSCodeLogger <: Logging.AbstractLogger end

function Logging.handle_message(j::VSCodeLogger, level, message, _module,
                                group, id, file, line; kwargs...)
    progress = ProgessBase.asprogress(level, message, _module, group, id, file, line; kwargs...)
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

module ProgessBase

using Base.Meta: isexpr
using UUIDs: UUID
using Logging: Logging, @logmsg, LogLevel

if VERSION >= v"1.1-"
    using UUIDs: uuid5
else
    import SHA
    function uuid5(ns::UUID, name::String)
        nsbytes = zeros(UInt8, 16)
        nsv = ns.value
        for idx in Base.OneTo(16)
            nsbytes[idx] = nsv >> 120
            nsv = nsv << 8
        end
        hash_result = SHA.sha1(append!(nsbytes, convert(Vector{UInt8}, codeunits(unescape_string(name)))))
        # set version number to 5
        hash_result[7] = (hash_result[7] & 0x0F) | (0x50)
        hash_result[9] = (hash_result[9] & 0x3F) | (0x80)
        v = zero(UInt128)
        # use only the first 16 bytes of the SHA1 hash
        for idx in Base.OneTo(16)
            v = (v << 0x08) | hash_result[idx]
        end
        return UUID(v)
    end
end

const ProgressLevel = LogLevel(-1)

"""
    ProgessBase.ROOTID

This is used as `parentid` of root [`Progress`](@ref)es.
"""
const ROOTID = UUID(0)

"""
    ProgessBase.Progress(id, [fraction]; [parentid, name, done])

# Usage: Progress log record provider

Progress log record can be created by using the following pattern

```julia
id = uuid4()
try
    @info Progress(id)  # create a progress bar
    # some time consuming job
    # ...
    @info Progress(id, 0.1)  # update progress to 10%
    # ...
finally
    @info Progress(id, done = true)  # close the progress bar
end
```

It is recommended to use [`@withprogress`](@ref),
[`@logprogress`](@ref), and optionally [`@progressid`](@ref) to create
log records.

# Usage: Progress log record consumer (aka progress monitor)

It is recommended to use [`ProgessBase.asprogress`](@ref) instead
of checking `message isa Progress`.  Progress monitors can retrieve
progress-related information from the following properties.

# Properties
- `fraction::Union{Float64,Nothing}`: it can take following values:
  - `0 <= fraction < 1`
  - `fraction >= 1`: completed
  - `fraction = nothing`: indeterminate progress
- `id::UUID`: Identifier of the job whose progress is at `fraction`.
- `parentid::UUID`: The ID of the parent progress.  It is set to
  [`ProgessBase.ROOTID`](@ref) when there is no parent progress.
  This is used for representing progresses of nested jobs.  Note that
  sub-jobs may be executed concurrently; i.e., there can be multiple
  child jobs for one parent job.
- `name::String`: Name of the progress bar.
- `done::Bool`: `true` if the job is done.
"""
struct Progress
    id::UUID
    parentid::UUID
    fraction::Union{Float64,Nothing}
    name::String
    done::Bool

    function Progress(id, parentid, fraction, name, done)
        if fraction isa Real && isnan(fraction)
            fraction = nothing
        end
        return new(id, parentid, fraction, name, done)
    end
end

Progress(;
    id::UUID,
    parentid::UUID = ROOTID,  # not nested by default
    fraction::Union{Real,Nothing} = nothing,
    name::String = "",
    done::Bool = false,
) = Progress(id, parentid, fraction, name, done)

Progress(id::UUID, fraction::Union{Real,Nothing} = nothing; kwargs...) =
    Progress(; kwargs..., fraction = fraction, id = id)

const PROGRESS_LOGGING_UUID_NS = UUID("1e962757-ea70-431a-b9f6-aadf988dcb7f")

asuuid(id::UUID) = id
asuuid(id) = uuid5(PROGRESS_LOGGING_UUID_NS, repr(id))


"""
    ProgessBase.asprogress(_, name, _, _, id, _, _; progress, ...) :: Union{Progress, Nothing}

Pre-process log record to obtain a [`Progress`](@ref) object if it is
one of the supported format.  This is mean to be used with the
`message` positional argument and _all_ keyword arguments passed to
`Logging.handle_message`.  Example:

```julia
function Logging.handle_message(logger::MyLogger, args...; kwargs...)
    progress = ProgessBase.asprogress(args...; kwargs...)
    if progress !== nothing
        return # handle progress log record
    end
    # handle normal log record
end
```
"""
asprogress(_level, progress::Progress, _args...; _...) = progress
function asprogress(
        _level,
        name,
        _module,
        _group,
        id,
        _file,
        _line;
        progress = undef,  # `undef` is an arbitrary unsupported value
        kwargs...,
    )
    if hasfield(typeof(name), :progress) && is_progresslike(name.progress)
        return _asprogress(name.progress)
    end
    if progress isa Union{Nothing,Real,AbstractString}
        return _asprogress(name, id; progress = progress, kwargs...)
    else
        if is_progresslike(progress)
            return _asprogress(progress)
        end
        return nothing
    end
end

is_progresslike(_::T) where {T} = all(in.(fieldnames(Progress), Ref(fieldnames(T))))

_asprogress(progress) = Progress((getfield(progress, f) for f in fieldnames(Progress))...)

# `parentid` is used from `@logprogress`.
function _asprogress(name, id, parentid = ROOTID; progress, _...)
    if progress isa Union{Nothing,Real}
        fraction = progress
    elseif progress == "done"
        fraction = nothing
    else
        return nothing
    end
    return Progress(
        fraction = fraction,
        name = name,
        id = asuuid(id),
        parentid = parentid,
        done = progress == "done",
    )
end

end # module
