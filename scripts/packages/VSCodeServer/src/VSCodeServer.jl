module VSCodeServer

using REPL, Sockets, Base64, Pkg, UUIDs
import Base: display, redisplay
import Dates


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

module JSONRPC
    import ..JSON
    import ..UUIDs

    include("../../JSONRPC/src/core.jl")
end

include("misc.jl")
include("trees.jl")
include("repl.jl")
include("../../../debugger/debugger.jl")
include("gridviewer.jl")

const INLINE_RESULT_LENGTH = 100
const MAX_RESULT_LENGTH = 10_000

function get_variables()
    M = Main
    variables = []
    clear_lazy()

    for n in names(M, all=true, imported=true)
        !isdefined(M, n) && continue
        Base.isdeprecated(M, n) && continue

        x = getfield(M, n)
        x === vscodedisplay && continue
        x === VSCodeServer && continue
        x === Main && continue

        n_as_string = string(n)
        startswith(n_as_string, "#") && continue
        t = typeof(x)

        rendered = treerender(x)

        push!(variables, Dict(
            "type" => string(t),
            "value" => get(rendered, :head, "???"),
            "name" => n_as_string,
            "id" => get(rendered, :id, get(get(rendered, :child, Dict()), :id, false)),
            "haschildren" => get(rendered, :haschildren, false),
            "lazy" => get(rendered, :lazy, false),
            "icon" => get(rendered, :icon, ""),
            "canshow" => can_display(x)
        ))
    end

    return variables
end

struct InlineDisplay <: AbstractDisplay end

function ends_with_semicolon(x)
    return REPL.ends_with_semicolon(split(x,'\n',keepempty = false)[end])
end

function sendDisplayMsg(kind, data)
    JSONRPC.send_notification(conn_endpoint[], "display", Dict{String,String}("kind"=>kind, "data"=>data))
end

"""
    render(x)

Produce a representation of `x` that can be displayed by a UI. Must return a dictionary with
the following fields:
- `inline`: Short one-line plain text representation of `x`. Typically limited to `INLINE_RESULT_LENGTH` characters.
- `all`: Plain text string (that may contain linebreaks and other signficant whitespace) to further describe `x`.
- `iserr`: Boolean. The frontend may style the UI differently depending on this value.
"""
function render(x)
    str = sprintlimited(MIME"text/plain"(), x, limit = MAX_RESULT_LENGTH)

    return Dict(
        "inline" => strlimit(first(split(str, "\n")), limit = INLINE_RESULT_LENGTH),
        "all" => str
    )
end

function render(::Nothing)
    return Dict(
        "inline" => "✓",
        "all" => "nothing"
    )
end

struct EvalError
    err
    bt
end

function render(err::EvalError)
    bt = err.bt
    st = stacktrace(bt)
    bti = find_frame_index(bt, @__FILE__, inlineeval)
    sti = find_frame_index(st, @__FILE__, inlineeval)
    bt = bt[1:(bti === nothing ? end : bti - 4)]
    st = st[1:(sti === nothing ? end : sti - 4)]
    str = sprintlimited(err.err, bt, func = Base.display_error, limit = MAX_RESULT_LENGTH)
    sf = frame.(st)
    return Dict(
        "inline" => strlimit(first(split(str, "\n")), limit = INLINE_RESULT_LENGTH),
        "all" => str,
        "stackframe" => sf
    )
end

frame(s) = (path = fullpath(string(s.file)), line = s.line)

"""
    safe_render(x)

Calls `render`, but catches errors in the display system.
"""
function safe_render(x)
    try
        render(x)
    catch err
        out = render(EvalError(err, catch_backtrace()))
        out["inline"] = string("Display Error: ", out["inline"])
        out["all"] = string("Display Error: ", out["all"])
    end
end

function module_from_string(mod)
    ms = split(mod, '.')

    out = Main

    loaded_module = findfirst(==(first(ms)), string.(Base.loaded_modules_array()))

    if loaded_module !== nothing
        out = Base.loaded_modules_array()[loaded_module]
        popfirst!(ms)
    end

    for m in Symbol.(ms)
        if isdefined(out, m)
            resolved = getfield(out, m)

            if resolved isa Module
                out = resolved
            else
                return out
            end
        end
    end

    return out
end

is_module_loaded(mod) = mod == "Main" || module_from_string(mod) !== Main

function get_modules(toplevel = nothing, mods = Set(Module[]))
    top_mods = toplevel === nothing ? Base.loaded_modules_array() : [toplevel]

    for mod in top_mods
        push!(mods, mod)

        for name in names(mod, all=true)
            if !Base.isdeprecated(mod, name) && isdefined(mod, name)
                thismod = getfield(mod, name)
                if thismod isa Module && thismod !== mod && !(thismod in mods)
                    push!(mods, thismod)
                    get_modules(thismod, mods)
                end
            end
        end
    end
    mods
end

const conn_endpoint = Ref{Union{Nothing,JSONRPC.JSONRPCEndpoint}}(nothing)

isactive() = conn_endpoint[] !== nothing

function serve(args...; is_dev = false, crashreporting_pipename::Union{AbstractString,Nothing}=nothing)
    conn = connect(args...)
    conn_endpoint[] = JSONRPC.JSONRPCEndpoint(conn, conn)
    run(conn_endpoint[])

    if is_dev
        @async while true
            try
                Base.invokelatest(handle_message)
            catch err
                Base.display_error(err, catch_backtrace())
            end
        end
    else
        @async try
            while true
                handle_message(crashreporting_pipename=crashreporting_pipename)
            end
        catch err
            Base.display_error(err, catch_backtrace())
        end
    end
end

# don't inline this so we can find it in the stacktrace
@noinline function inlineeval(m, code, code_line, code_column, file)
    code = string('\n' ^ code_line, ' ' ^ code_column, code)
    return Base.invokelatest(include_string, m, code, file)
end

function handle_message(; crashreporting_pipename::Union{AbstractString,Nothing}=nothing)
    msg = JSONRPC.get_next_message(conn_endpoint[])
    if msg["method"] == "repl/runcode"
        params = msg["params"]

        source_filename = params["filename"]
        code_line = params["line"]
        code_column = params["column"]
        source_code = params["code"]
        mod = params["module"]

        resolved_mod = try
            module_from_string(mod)
        catch err
            # maybe trigger error reporting here
            Main
        end

        show_code = params["showCodeInREPL"]
        show_result = params["showResultInREPL"]

        hideprompt() do
            if isdefined(Main, :Revise) && isdefined(Main.Revise, :revise) && Main.Revise.revise isa Function
                let mode = get(ENV, "JULIA_REVISE", "auto")
                    mode == "auto" && Main.Revise.revise()
                end
            end
            if show_code
                for (i,line) in enumerate(eachline(IOBuffer(source_code)))
                    if i==1
                        printstyled("julia> ", color=:green)
                        print(' '^code_column)
                    else
                        # Indent by 7 so that it aligns with the julia> prompt
                        print(' '^7)
                    end

                    println(line)
                end
            end

            withpath(source_filename) do
                res = try
                    ans = inlineeval(resolved_mod, source_code, code_line, code_column, source_filename)
                    @eval Main ans = $(QuoteNode(ans))
                catch err
                    EvalError(err, catch_backtrace())
                end

                if show_result
                    if res isa EvalError
                        Base.display_error(stderr, res.err, res.bt)
                    elseif res !== nothing && !ends_with_semicolon(source_code)
                        Base.invokelatest(display, res)
                    end
                else
                    try
                        Base.invokelatest(display, InlineDisplay(), res)
                    catch err
                        if !(err isa MethodError)
                            printstyled(stderr, "Display Error: ", color = Base.error_color(), bold = true)
                            Base.display_error(stderr, err, catch_backtrace())
                        end
                    end
                end

                JSONRPC.send_success_response(conn_endpoint[], msg, safe_render(res))
            end
        end
    elseif msg["method"] == "repl/getvariables"
        vars = get_variables()

        JSONRPC.send_success_response(conn_endpoint[], msg, vars)
    elseif msg["method"] == "repl/getlazy"
        JSONRPC.send_success_response(conn_endpoint[], msg, get_lazy(msg["params"]))
    elseif msg["method"] == "repl/showingrid"
        try
            var = Core.eval(Main, Meta.parse(msg["params"]))

            Base.invokelatest(internal_vscodedisplay, var)
        catch err
            Base.display_error(err, catch_backtrace())
        end
    elseif msg["method"] == "repl/loadedModules"
        JSONRPC.send_success_response(conn_endpoint[], msg, string.(collect(get_modules())))
    elseif msg["method"] == "repl/isModuleLoaded"
        mod = msg["params"]

        is_loaded = is_module_loaded(mod)

        JSONRPC.send_success_response(conn_endpoint[], msg, is_loaded)
    elseif msg["method"] == "repl/startdebugger"
        hideprompt() do
            debug_pipename = msg["params"]
            try
                VSCodeDebugger.startdebug(debug_pipename)
            catch err
                VSCodeDebugger.global_err_handler(err, catch_backtrace(), crashreporting_pipename, "Debugger")
            end
        end
    end
end

function display(d::InlineDisplay, ::MIME{Symbol("image/png")}, x)
    payload = stringmime(MIME("image/png"), x)
    sendDisplayMsg("image/png", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("image/png")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("image/svg+xml")}, x)
    payload = stringmime(MIME("image/svg+xml"), x)
    sendDisplayMsg("image/svg+xml", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("image/svg+xml")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("text/html")}, x)
    payload = stringmime(MIME("text/html"), x)
    sendDisplayMsg("text/html", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("text/html")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("juliavscode/html")}, x)
    payload = stringmime(MIME("juliavscode/html"), x)
    sendDisplayMsg("juliavscode/html", payload)
end

Base.Multimedia.istextmime(::MIME{Symbol("juliavscode/html")}) = true

displayable(d::InlineDisplay, ::MIME{Symbol("juliavscode/html")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v2+json")}, x)
    payload = stringmime(MIME("application/vnd.vegalite.v2+json"), x)
    sendDisplayMsg("application/vnd.vegalite.v2+json", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v2+json")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v3+json")}, x)
    payload = stringmime(MIME("application/vnd.vegalite.v3+json"), x)
    sendDisplayMsg("application/vnd.vegalite.v3+json", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v3+json")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v4+json")}, x)
    payload = stringmime(MIME("application/vnd.vegalite.v4+json"), x)
    sendDisplayMsg("application/vnd.vegalite.v4+json", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v4+json")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.vega.v3+json")}, x)
    payload = stringmime(MIME("application/vnd.vega.v3+json"), x)
    sendDisplayMsg("application/vnd.vega.v3+json", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.vega.v3+json")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.vega.v4+json")}, x)
    payload = stringmime(MIME("application/vnd.vega.v4+json"), x)
    sendDisplayMsg("application/vnd.vega.v4+json", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.vega.v4+json")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.vega.v5+json")}, x)
    payload = stringmime(MIME("application/vnd.vega.v5+json"), x)
    sendDisplayMsg("application/vnd.vega.v5+json", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.vega.v5+json")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.plotly.v1+json")}, x)
    payload = stringmime(MIME("application/vnd.plotly.v1+json"), x)
    sendDisplayMsg("application/vnd.plotly.v1+json", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.dataresource+json")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.dataresource+json")}, x)
    payload = stringmime(MIME("application/vnd.dataresource+json"), x)
    sendDisplayMsg("application/vnd.dataresource+json", payload)
end

Base.Multimedia.istextmime(::MIME{Symbol("application/vnd.dataresource+json")}) = true

displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.plotly.v1+json")}) = true

const DISPLAYABLE_MIMES = [
    "application/vnd.vegalite.v4+json",
    "application/vnd.vegalite.v3+json",
    "application/vnd.vegalite.v2+json",
    "application/vnd.vega.v5+json",
    "application/vnd.vega.v4+json",
    "application/vnd.vega.v3+json",
    "application/vnd.plotly.v1+json",
    "juliavscode/html",
    # "text/html",
    "image/svg+xml",
    "image/png"
]

function can_display(x)
    for mime in DISPLAYABLE_MIMES
        if showable(mime, x)
            return true
        end
    end

    if showable("application/vnd.dataresource+json", x)
        return true
    end

    istable = Base.invokelatest(_isiterabletable, x)

    if istable === missing || istable === true || x isa AbstractVector || x isa AbstractMatrix
        return true
    end

    return false
end

function Base.display(d::InlineDisplay, x)
    for mime in DISPLAYABLE_MIMES
        if showable(mime, x)
            return display(d, mime, x)
        end
    end

    throw(MethodError(display,(d,x)))
end

function _display(d::InlineDisplay, x)
    if showable("application/vnd.dataresource+json", x)
        display(d, "application/vnd.dataresource+json", x)
    else
        try
            display(d, x)
        catch err
            if err isa MethodError
                @warn "Cannot display values of type $(typeof(x)) in VS Code."
            else
                rethrow(err)
            end
        end
    end
end

const tabletraits_uuid = UUIDs.UUID("3783bdb8-4a98-5b6b-af9a-565f29a5fe9c")
const datavalues_uuid = UUIDs.UUID("e7dc6d0d-1eca-5fa6-8ad6-5aecde8b7ea5")

global _isiterabletable = i -> false
global _getiterator = i -> i

function pkgload(pkg)
    if pkg.uuid==tabletraits_uuid
        x = Base.require(pkg)

        global _isiterabletable = x.isiterabletable
        global _getiterator = x.getiterator
    elseif pkg.uuid==datavalues_uuid
        x = Base.require(pkg)

        eval(
            quote
                function JSON_print_escaped(io, val::$(x.DataValue))
                    $(x.isna)(val) ? print(io, "null") : JSON_print_escaped(io, val[])
                end

                julia_type_to_schema_type(::Type{T}) where {S, T<:$(x.DataValue){S}} = julia_type_to_schema_type(S)
            end
        )
    end
end

function remove_lln!(ex::Expr)
    for i in length(ex.args):-1:1
        if ex.args[i] isa LineNumberNode
            deleteat!(ex.args, i)
        elseif ex.args[i] isa Expr
            remove_lln!(ex.args[i])
        end
    end
end

function internal_vscodedisplay(x)
    if showable("application/vnd.dataresource+json", x)
        _display(InlineDisplay(), x)
    elseif _isiterabletable(x)===true
        buffer = IOBuffer()
        io = IOContext(buffer, :compact=>true)
        printdataresource(io, _getiterator(x))
        buffer_asstring = CachedDataResourceString(String(take!(buffer)))
        _display(InlineDisplay(), buffer_asstring)
    elseif _isiterabletable(x)===missing
        try
            buffer = IOBuffer()
            io = IOContext(buffer, :compact=>true)
            printdataresource(io, _getiterator(x))
            buffer_asstring = CachedDataResourceString(String(take!(buffer)))
            _display(InlineDisplay(), buffer_asstring)
        catch err
            _display(InlineDisplay(), x)
        end
    elseif x isa AbstractVector || x isa AbstractMatrix
        buffer = IOBuffer()
        io = IOContext(buffer, :compact=>true)
        print_array_as_dataresource(io, _getiterator(x))
        buffer_asstring = CachedDataResourceString(String(take!(buffer)))
        _display(InlineDisplay(), buffer_asstring)
    else
        _display(InlineDisplay(), x)
    end
end

vscodedisplay(x) = internal_vscodedisplay(x)
vscodedisplay() = i -> vscodedisplay(i)

macro enter(command)
    remove_lln!(command)
    :(JSONRPC.send_notification(conn_endpoint[], "debugger/enter", $(string(command))))
end

macro run(command)
    remove_lln!(command)
    :(JSONRPC.send_notification(conn_endpoint[], "debugger/run", $(string(command))))
end

export vscodedisplay, @enter, @run

end  # module
