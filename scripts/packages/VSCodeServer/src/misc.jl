import UUIDs: uuid1
import InteractiveUtils: @which

# error handling
# --------------

function find_first_topelevel_scope(bt::Vector{<:Union{Base.InterpreterIP,Ptr{Cvoid}}})
    for (i, ip) in enumerate(bt)
        st = Base.StackTraces.lookup(ip)
        ind = findfirst(st) do frame
            linfo = frame.linfo
            if linfo isa Core.CodeInfo
                linetable = linfo.linetable
                if isa(linetable, Vector) && length(linetable) ≥ 1
                    lin = first(linetable)
                    if isa(lin, Core.LineInfoNode) && lin.method === Symbol("top-level scope")
                        return true
                    end
                end
            else
                return frame.func === Symbol("top-level scope")
            end
        end
        ind === nothing || return i
    end
    return
end

# path utilitiles
# ---------------

function fullpath(path)
    return if isuntitled(path)
        path
    elseif isabspath(path)
        maybe_fix_stdlib_path(path)
    else
        basepath(path)
    end |> realpath′
end

isuntitled(path) = occursin(r"Untitled-\d+$", path)
basepath(path) = normpath(joinpath(Sys.BINDIR, Base.DATAROOTDIR, "julia", "base", path))

function realpath′(p)
    try
        ispath(p) ? realpath(p) : p
    catch e
        p
    end |> normpath
end

# https://github.com/timholy/CodeTracking.jl/blob/2ba66f6f7864c6a3e06887a6832787bb3dc8e9be/src/utils.jl
const BUILDBOT_STDLIB_PATH = dirname(abspath(joinpath(String((@which uuid1()).file), "..", "..", "..")))
replace_buildbot_stdlibpath(str::String) = replace(str, BUILDBOT_STDLIB_PATH => Sys.STDLIB)
function maybe_fix_stdlib_path(p)
    if !ispath′(p)
        p_fix = replace_buildbot_stdlibpath(p)
        ispath′(p_fix) && return p_fix
    end
    p
end

ispath′(p) = try
    ispath(p)
catch err
    false
end


# string utilitiles
# -----------------

# https://github.com/JuliaDebug/Debugger.jl/blob/4cf99c662ab89da0fe7380c1e81461e2428e8b00/src/limitio.jl

mutable struct LimitIO{IO_t<:IO} <: IO
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

function ends_with_semicolon(x)
    lines = split(x, '\n', keepempty=false)
    return length(lines) > 0 ?
        REPL.ends_with_semicolon(last(lines)) :
        false
end

const splitlines = Base.Fix2(split, '\n')
const joinlines = Base.Fix2(join, '\n')


# VSCode specific
# ---------------

using Printf

const UNESCAPED = Set(codeunits("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_.!~*'()"))

function encode_uri_component(uri)
    isvalid(uri) || throw(ArgumentError("`encode_uri_component` can only handle valid UTF8 strings."))

    io = IOBuffer()
    for cp in codeunits(uri)
        if cp in UNESCAPED
            print(io, Char(cp))
        else
            print(io, '%')
            @printf(io, "%2X", cp)
        end
    end
    return String(take!(io))
end

vscode_cmd_uri(cmd; cmdargs...) = string("command:", cmd, '?', encode_uri_component(JSON.json(cmdargs)))

# Misc handlers
function cd_to_uri(conn, params::NamedTuple{(:uri,),Tuple{String}})
    cd(params.uri)
    return nothing
end

function activate_uri(conn, params::NamedTuple{(:uri,),Tuple{String}})
    hideprompt(() -> Pkg.activate(params.uri))
    return nothing
end

# Revise.revise, if loaded
function revise()
    if isdefined(Main, :Revise) && isdefined(Main.Revise, :revise) && Main.Revise.revise isa Function
        let mode = get(ENV, "JULIA_REVISE", "auto")
            mode == "auto" && Base.invokelatest(Main.Revise.revise)
        end
    end
end
