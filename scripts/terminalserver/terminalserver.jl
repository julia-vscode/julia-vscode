module _vscodeserver

using REPL, Sockets, Base64, Pkg, UUIDs
import Base: display, redisplay
import Dates

include("../languageserver/packages/JSON/src/JSON.jl")

include("gridviewer.jl")

module JSONRPC
    import ..JSON
    import ..UUIDs

    include("../packages/JSONRPC/src/core.jl")
end

include("repl.jl")
include("../debugger/debugger.jl")

struct InlineDisplay <: AbstractDisplay end

repl_pipename = Base.ARGS[1]

!(Sys.isunix() || Sys.iswindows()) && error("Unknown operating system.")

function ends_with_semicolon(x)
    return REPL.ends_with_semicolon(split(x,'\n',keepempty = false)[end])
end

repl_conn = connect(repl_pipename)

conn_endpoint = JSONRPC.JSONRPCEndpoint(repl_conn, repl_conn)

function sendDisplayMsg(kind, data)
    JSONRPC.send_notification(conn_endpoint, "display", Dict{String,String}("kind"=>kind, "data"=>data))
end


run(conn_endpoint)

@async begin

    while true
        msg = JSONRPC.get_next_message(conn_endpoint)

        if msg["method"] == "repl/runcode"
            params = msg["params"]


            source_filename = params["filename"]
            code_line = params["line"]
            code_column = params["column"]
            source_code = params["code"]

            hideprompt() do
                if isdefined(Main, :Revise) && isdefined(Main.Revise, :revise) && Main.Revise.revise isa Function
                    let mode = get(ENV, "JULIA_REVISE", "auto")
                        mode == "auto" && Main.Revise.revise()
                    end
                end
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

                try
                    withpath(source_filename) do
                        res = Base.invokelatest(include_string, Main, '\n'^code_line * ' '^code_column *  source_code, source_filename)

                        if res !== nothing && !ends_with_semicolon(source_code)
                            Base.invokelatest(display, res)
                        end
                    end
                catch err
                    Base.display_error(stderr, err, catch_backtrace())
                end
            end
        elseif msg["method"] == "repl/startdebugger"
            hideprompt() do
                debug_pipename = msg["params"]
                try
                    VSCodeDebugger.startdebug(debug_pipename)
                catch err
                    VSCodeDebugger.global_err_handler(err, catch_backtrace(), ARGS[4])
                end
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

function display(d::InlineDisplay, x)
    if showable("application/vnd.vegalite.v4+json", x)
        display(d,"application/vnd.vegalite.v4+json", x)
    elseif showable("application/vnd.vegalite.v3+json", x)
        display(d,"application/vnd.vegalite.v3+json", x)
    elseif showable("application/vnd.vegalite.v2+json", x)
        display(d,"application/vnd.vegalite.v2+json", x)
    elseif showable("application/vnd.vega.v5+json", x)
        display(d,"application/vnd.vega.v5+json", x)
    elseif showable("application/vnd.vega.v4+json", x)
        display(d,"application/vnd.vega.v4+json", x)
    elseif showable("application/vnd.vega.v3+json", x)
        display(d,"application/vnd.vega.v3+json", x)
    elseif showable("application/vnd.plotly.v1+json", x)
        display(d,"application/vnd.plotly.v1+json", x)
    elseif showable("juliavscode/html", x)
        display(d,"juliavscode/html", x)
    # elseif showable("text/html", x)
    #     display(d,"text/html", x)
    elseif showable("image/svg+xml", x)
        display(d,"image/svg+xml", x)
    elseif showable("image/png", x)
        display(d,"image/png", x)
    else
        throw(MethodError(display,(d,x)))
    end
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

if length(Base.ARGS) >= 3 && Base.ARGS[3] == "true"
    atreplinit(i->Base.Multimedia.pushdisplay(InlineDisplay()))
end

# Load revise?
load_revise = Base.ARGS[2] == "true"

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

        eval(quote
            function JSON_print_escaped(io, val::$(x.DataValue))
                $(x.isna)(val) ? print(io, "null") : JSON_print_escaped(io, val[])
            end

            julia_type_to_schema_type(::Type{T}) where {S, T<:$(x.DataValue){S}} = julia_type_to_schema_type(S)
        end)
    end
end

push!(Base.package_callbacks, pkgload)

function remove_lln!(ex::Expr)
    for i in length(ex.args):-1:1
        if ex.args[i] isa LineNumberNode
            deleteat!(ex.args, i)
        elseif ex.args[i] isa Expr
            remove_lln!(ex.args[i])
        end
    end
end

end

function vscodedisplay(x)
    if showable("application/vnd.dataresource+json", x)
        _vscodeserver._display(_vscodeserver.InlineDisplay(), x)
    elseif _vscodeserver._isiterabletable(x)===true
        buffer = IOBuffer()
        io = IOContext(buffer, :compact=>true)
        _vscodeserver.printdataresource(io, _vscodeserver._getiterator(x))
        buffer_asstring = _vscodeserver.CachedDataResourceString(String(take!(buffer)))
        _vscodeserver._display(_vscodeserver.InlineDisplay(), buffer_asstring)
    elseif _vscodeserver._isiterabletable(x)===missing
        try
            buffer = IOBuffer()
            io = IOContext(buffer, :compact=>true)
            _vscodeserver.printdataresource(io, _vscodeserver._getiterator(x))
            buffer_asstring = _vscodeserver.CachedDataResourceString(String(take!(buffer)))
            _vscodeserver._display(_vscodeserver.InlineDisplay(), buffer_asstring)
        catch err
            _vscodeserver._display(_vscodeserver.InlineDisplay(), x)
        end
    elseif x isa AbstractVector || x isa AbstractMatrix
        buffer = IOBuffer()
        io = IOContext(buffer, :compact=>true)
        _vscodeserver.print_array_as_dataresource(io, _vscodeserver._getiterator(x))
        buffer_asstring = _vscodeserver.CachedDataResourceString(String(take!(buffer)))
        _vscodeserver._display(_vscodeserver.InlineDisplay(), buffer_asstring)
    else
        _vscodeserver._display(_vscodeserver.InlineDisplay(), x)
    end
end

vscodedisplay() = i -> vscodedisplay(i)

if _vscodeserver.load_revise
    try
        @eval using Revise
        Revise.async_steal_repl_backend()
    catch err
    end
end

macro enter(command)
    _vscodeserver.remove_lln!(command)
    :(_vscodeserver.JSONRPC.send_notification(_vscodeserver.conn_endpoint, "debugger/enter", $(string(command))))
end

macro run(command)
    _vscodeserver.remove_lln!(command)
    :(_vscodeserver.JSONRPC.send_notification(_vscodeserver.conn_endpoint, "debugger/run", $(string(command))))
end
