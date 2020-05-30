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

function getVariables()
    M = Main
    variables = []
    for n in names(M)
        !isdefined(M, n) && continue
        x = getfield(M, n)
        x isa Module && continue
        x==Main.vscodedisplay && continue
        n_as_string = string(n)
        n_as_string=="@run" && continue
        n_as_string=="@enter" && continue
        startswith(n_as_string, "#") && continue
        t = typeof(x)
        value_as_string = Base.invokelatest(repr, x)

        push!(variables, (name=string(n), type=string(t), value=value_as_string))
    end
    return variables
end

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

@async try
    while true
        msg = JSONRPC.get_next_message(conn_endpoint)

        if msg["method"] == "repl/getvariables"
            vars = getVariables()
            JSONRPC.send_notification(conn_endpoint, "repl/variables", [Dict{String,String}("name"=>i.name, "type"=>i.type, "value"=>i.value) for i in vars])
        elseif msg["method"] == "repl/runcode"
            params = msg["params"]


            source_filename = params["filename"]
            code_line = params["line"]
            code_column = params["column"]
            source_code = params["code"]

            JSONRPC.send_notification(conn_endpoint, "repl/starteval", nothing)
            try
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
            finally
                JSONRPC.send_notification(conn_endpoint, "repl/finisheval", nothing)
            end
        elseif msg["method"] == "repl/showingrid"
            var = Core.eval(Main, Meta.parse(msg["params"]))

            try
                Base.invokelatest(internal_vscodedisplay, var)
            catch err
                Base.display_error(err, catch_backtrace())
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
catch err
    Base.display_error(err, catch_backtrace())
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

function Base.display(d::InlineDisplay, x)
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

function hook_repl(repl)
    main_mode = get_main_mode()

    main_mode.on_done = REPL.respond(Base.active_repl, main_mode; pass_empty = false) do line

        x = Base.parse_input_line(line,filename=REPL.repl_filename(repl,main_mode.hist))

        if !(x isa Expr && x.head == :toplevel)
            error("VS Code Julia REPL got an unexpected input.")
        end

        # Replace all top level assignments with a global top level assignment
        # so that they happen, even though the code now runs inside a
        # try ... finally block
        for i in 1:length(x.args)
            if x.args[i] isa Expr && x.args[i].head==:(=)
                x.args[i] = Expr(:global, x.args[i])
            end
        end

        q = Expr(:toplevel,
            Expr(:try,
                Expr(:block,
                    quote
                        try
                            $(JSONRPC.send_notification)($conn_endpoint, "repl/starteval", nothing)
                        catch err
                        end
                    end,
                    x.args...
                ),
                false,
                false,
                quote
                    try
                        $(JSONRPC.send_notification)($conn_endpoint, "repl/finisheval", nothing)
                    catch err
                    end
                end
            )
        )

        return q
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
        _vscodeserver.print_array_as_dataresource(io, _vscodeserver._getiterator(x))
        buffer_asstring = _vscodeserver.CachedDataResourceString(String(take!(buffer)))
        _vscodeserver._display(_vscodeserver.InlineDisplay(), buffer_asstring)
    else
        _display(InlineDisplay(), x)
    end
end

end

atreplinit() do repl
    @async try
        sleep(1)
        _vscodeserver.hook_repl(repl)
    catch err
        Base.display_error(err, catch_backtrace())
    end

    if length(Base.ARGS) >= 3 && Base.ARGS[3] == "true"
        Base.Multimedia.pushdisplay(_vscodeserver.InlineDisplay())
    end
end

function vscodedisplay(x)
    _vscodeserver.internal_vscodedisplay(x)
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
