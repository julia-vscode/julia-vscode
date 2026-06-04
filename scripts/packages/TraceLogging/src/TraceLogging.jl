module TraceLogging

import UUIDs: uuid4
using Logging: Logging, @logmsg, LogLevel

export trace, @trace, TraceSpan, TracingLevel, TracingLogger,
    current_span_id, current_trace_id

const TracingLevel = LogLevel(-1)

const CURRENT_SPAN_ID = Base.ScopedValues.ScopedValue{Union{Nothing,String}}(nothing)
const TRACE_ID = Base.ScopedValues.ScopedValue{Union{Nothing,String}}(nothing)

"""
    current_span_id() -> Union{Nothing,String}

Return the operation id of the currently-executing trace span, or `nothing` if not currently
inside a [`trace`](@ref) scope.
"""
current_span_id() = CURRENT_SPAN_ID[]

"""
    current_trace_id() -> Union{Nothing,String}

Return the root trace id of the current trace tree, or `nothing` if not currently inside a
[`trace`](@ref) scope. Stable across the whole tree; intended as the shared OpenTelemetry
trace id.
"""
current_trace_id() = TRACE_ID[]

# A completed trace span. `start_time_ns` is the raw monotonic `time_ns()` value captured
# when the span started; converting it to a wall-clock time is the responsibility of the
# consumer (e.g. the language server instance), which owns a `(time(), time_ns())` reference
# pair. Keeping the raw nanosecond value here avoids any precision loss in this layer.
struct TraceSpan{A<:NamedTuple}
    name::String
    operation_id::String
    parent_operation_id::Union{Nothing,String}
    root_operation_id::String
    start_time_ns::UInt64
    duration_ns::UInt64
    attributes::A
end

function _trace(f, name, attributes)
    span_id = string(uuid4())

    v, start_time_ns, duration = Base.ScopedValues.with(CURRENT_SPAN_ID => span_id) do
        t0 = time_ns()
        ret = f()
        duration = time_ns() - t0

        return ret, t0, duration
    end

    @logmsg TracingLevel TraceSpan(
        name,
        span_id,
        CURRENT_SPAN_ID[],
        TRACE_ID[],
        start_time_ns,
        duration,
        attributes
    )

    return v
end

"""
    trace(f, name; attributes...)

Run `f()` as a trace span named `name`, recording its timing and emitting a [`TraceSpan`](@ref)
to the active logger when it completes. Any keyword arguments are attached to the span as its
`attributes` (a `NamedTuple`).

The first span established seeds a root trace id; nested `trace` calls inherit it and record
the enclosing span as their parent.
"""
function trace(f, name; attributes...)
    attrs = values(attributes)
    if TRACE_ID[] === nothing
        root_id = string(uuid4())
        return Base.ScopedValues.with(TRACE_ID => root_id) do
            return _trace(f, name, attrs)
        end
    else
        return _trace(f, name, attrs)
    end
end

"""
    @trace expr

Instrument the function call `expr` as a trace span (see [`trace`](@ref)), using the called
function's name as the span name and the string representations of the call arguments as the
span's `attributes`.

In contrast to [`trace`](@ref), the call is instrumented inline: the generated code does not
wrap `expr` in a closure. Each positional argument is evaluated exactly once.

```julia
@trace foo(a, b, c)
```
"""
macro trace(ex)
    Meta.isexpr(ex, :call) ||
        error("`@trace` expects a function-call expression, e.g. `@trace foo(a, b, c)`")

    fname = ex.args[1]
    name = string(fname)

    params = nothing
    positional = Any[]
    for a in ex.args[2:end]
        if Meta.isexpr(a, :parameters)
            params = a
        else
            push!(positional, a)
        end
    end

    assignments = Expr[]
    attr_pairs = Expr[]
    call_args = Any[]
    for a in positional
        if Meta.isexpr(a, :...)
            # Splatted arguments are inlined directly (still evaluated once) and are not
            # turned into attributes.
            push!(call_args, esc(a))
        else
            tmp = gensym(:arg)
            push!(assignments, :($tmp = $(esc(a))))
            push!(attr_pairs, Expr(:(=), Symbol(string(a)), :(string($tmp))))
            push!(call_args, tmp)
        end
    end

    callexpr = Expr(:call, esc(fname))
    params === nothing || push!(callexpr.args, esc(params))
    append!(callexpr.args, call_args)

    attrs = isempty(attr_pairs) ? :(NamedTuple()) : Expr(:tuple, attr_pairs...)

    return quote
        let
            $(assignments...)
            span_id = string($(uuid4)())
            root_id = $(TRACE_ID)[] === nothing ? string($(uuid4)()) : $(TRACE_ID)[]
            parent_id = $(CURRENT_SPAN_ID)[]
            t0 = time_ns()
            result = Base.ScopedValues.@with $(TRACE_ID) => root_id $(CURRENT_SPAN_ID) => span_id $callexpr
            duration = time_ns() - t0
            Base.CoreLogging.@logmsg $TracingLevel $(TraceSpan)(
                $name,
                span_id,
                parent_id,
                root_id,
                t0,
                duration,
                $attrs,
            )
            result
        end
    end
end

"""
    TracingLogger(; on_trace=nothing, on_log=nothing, inner=nothing)

An `AbstractLogger` that acts as a single integration point for observability
backends (e.g. an OpenTelemetry endpoint).

It dispatches messages to two optional callbacks:

- `on_trace(span::TraceSpan)` is called for every completed trace span emitted by
  [`trace`](@ref). The span's `start_time_ns` is a raw monotonic `time_ns()` value.
- `on_log(log::NamedTuple)` is called for every regular log message emitted *while inside a
  [`trace`](@ref) scope* (records emitted outside any trace scope carry no span/trace
  correlation and are dropped without building a record). The named tuple has the fields
  `level`, `message`, `trace_id`, `span_id`, `time_ns`, `_module`, `group`, `id`, `file`,
  `line` and `kwargs`. `time_ns` is the raw monotonic `time_ns()` value captured when the
  record was handled. `trace_id` is the enclosing trace's root id and `span_id` the enclosing
  span id.

Both the span `start_time_ns` and the log `time_ns` are raw monotonic timestamps; converting
them to wall-clock times is left to the consumer, which can own a `(time(), time_ns())`
reference pair and pick whatever high-resolution representation it needs downstream.
"""
struct TracingLogger{TOnTrace,TOnLog} <: Logging.AbstractLogger
    on_trace::TOnTrace
    on_log::TOnLog
end

TracingLogger(; on_trace=nothing, on_log=nothing) =
    TracingLogger(on_trace, on_log)

function Logging.min_enabled_level(logger::TracingLogger)
    # Admit everything from `Debug` upwards as well as our own `TracingLevel` span records.
    # This must be no higher than `Debug`, otherwise the per-logger gate in compositional
    # loggers (`min_enabled_level(logger) <= level`) would drop `@debug` records before they
    # ever reach `handle_message`.
    return Logging.Debug
end

Logging.shouldlog(::TracingLogger, level, _module, group, id) = true

Logging.catch_exceptions(::TracingLogger) = true

function Logging.handle_message(logger::TracingLogger, level, message, _module, group, id, file, line; kwargs...)
    if level == TracingLevel && message isa TraceSpan
        if logger.on_trace !== nothing
            logger.on_trace(message)
        end
        return nothing
    end

    # Only records emitted within a trace scope carry the span/trace correlation this logger
    # exists to capture. Bail out before building the (allocating) log record for the common
    # case of out-of-scope messages, which no consumer of this logger wants.
    trace_id = TRACE_ID[]
    if logger.on_log !== nothing && trace_id !== nothing
        logger.on_log((
            level = level,
            message = message,
            trace_id = trace_id,
            span_id = CURRENT_SPAN_ID[],
            time_ns = time_ns(),
            _module = _module,
            group = group,
            id = id,
            file = file,
            line = line,
            kwargs = kwargs,
        ))
    end
    return nothing
end

end # module TraceLogging
