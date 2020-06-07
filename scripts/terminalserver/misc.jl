# string utilities
# ----------------

# https://github.com/JuliaDebug/Debugger.jl/blob/4cf99c662ab89da0fe7380c1e81461e2428e8b00/src/limitio.jl

mutable struct LimitIO{IO_t <: IO} <: IO
    io::IO_t
    maxbytes::Int
    n::Int
end
LimitIO(io::IO, maxbytes) = LimitIO(io, maxbytes, 0)

struct LimitIOException <: Exception end

function Base.write(io::LimitIO, v::UInt8)
    io.n > io.maxbytes && throw(LimitIOException())
    io.n += write(io.io, v)
end

function sprintlimited(args...; func = show, limit::Int = 30, ellipsis::AbstractString = "…", color = false)
    io = IOBuffer()
    ioctx = IOContext(LimitIO(io, limit - length(ellipsis)), :limit => true, :color => color, :displaysize => (30, 64))

    try
        Base.invokelatest(func, ioctx, args...)
    catch err
        if err isa LimitIOException
            print(io, ellipsis)
        else
            rethrow(err)
        end
    end

    str = filter(isvalid, String(take!(io)))

    return color ? str : remove_ansi_control_chars(str)
end

function strlimit(str; limit::Int = 30, ellipsis::AbstractString = "…")
    will_append = length(str) > limit

    io = IOBuffer()
    i = 1
    for c in str
        will_append && i > limit - length(ellipsis) && break
        isvalid(c) || continue

        print(io, c)
        i += 1
    end
    will_append && print(io, ellipsis)

    return String(take!(io))
end

# https://stackoverflow.com/a/33925425/12113178

function remove_ansi_control_chars(str::String)
    replace(str, r"(\x9B|\x1B\[)[0-?]*[ -\/]*[@-~]" => "")
end

# is utilities
# ------------

iskeyword(word::Symbol) = word in keys(Docs.keywords)
iskeyword(word::AbstractString) = iskeyword(Symbol(word))

# miscellaneous
# -------------

@inbounds interpose(xs, y) = map(i -> iseven(i) ? xs[i÷2] : y, 2:2length(xs))
