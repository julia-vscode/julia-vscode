module _vscodeserver

using REPL, Sockets, Base64, Pkg, UUIDs
import Base: display, redisplay
import Dates

include("../languageserver/packages/JSON/src/JSON.jl")

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


function is_module_loaded(mod)
    if mod == "Main"
        return true
    end

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
                return out !== Main
            end
        end
    end

    return out !== Main
end

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
        elseif msg["method"] == "repl/loadedModules"
            JSONRPC.send_success_response(conn_endpoint, msg, string.(collect(get_modules())))
        elseif msg["method"] == "repl/isModuleLoaded"
            mod = msg["params"]["module"]
            
            is_loaded = is_module_loaded(mod)
            
            JSONRPC.send_success_response(conn_endpoint, msg, is_loaded)
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
        display(d, x)
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

struct CachedDataResourceString
    content::String
end
Base.show(io::IO, ::MIME"application/vnd.dataresource+json", source::CachedDataResourceString) = print(io, source.content)
Base.showable(::MIME"application/vnd.dataresource+json", dt::CachedDataResourceString) = true

function JSON_print_escaped(io, val::AbstractString)
    print(io, '"')
    for c in val
        if c=='"' || c=='\\'
            print(io, '\\')
            print(io, c)
        elseif c=='\b'
            print(io, '\\')
            print(io, 'b')
        elseif c=='\f'
            print(io, '\\')
            print(io, 'f')
        elseif c=='\n'
            print(io, '\\')
            print(io, 'n')
        elseif c=='\r'
            print(io, '\\')
            print(io, 'r')
        elseif c=='\t'
            print(io, '\\')
            print(io, 't')
        else
            print(io, c)
        end
    end
    print(io, '"')
end

function JSON_print_escaped(io, val)
    print(io, '"')
    print(io, val)
    print(io, '"')
end

function JSON_print_escaped(io, val::Missing)
    print(io, "null")
end

julia_type_to_schema_type(::Type{T}) where {T} = "string"
julia_type_to_schema_type(::Type{T}) where {T<:AbstractFloat} = "number"
julia_type_to_schema_type(::Type{T}) where {T<:Integer} = "integer"
julia_type_to_schema_type(::Type{T}) where {T<:Bool} = "boolean"
julia_type_to_schema_type(::Type{T}) where {T<:Dates.Time} = "time"
julia_type_to_schema_type(::Type{T}) where {T<:Dates.Date} = "date"
julia_type_to_schema_type(::Type{T}) where {T<:Dates.DateTime} = "datetime"
julia_type_to_schema_type(::Type{T}) where {T<:AbstractString} = "string"

function printdataresource(io::IO, source)
    if Base.IteratorEltype(source) isa Base.EltypeUnknown
        first_el = first(source)
        col_names = String.(propertynames(first_el))
        col_types = [fieldtype(typeof(first_el), i) for i=1:length(col_names)]
    else
        col_names = String.(fieldnames(eltype(source)))
        col_types = [fieldtype(eltype(source), i) for i=1:length(col_names)]
    end

    print(io, "{")

    JSON_print_escaped(io, "schema")
    print(io, ": {")
    JSON_print_escaped(io, "fields")
    print(io, ":[")
    for i=1:length(col_names)
        if i>1
            print(io, ",")
        end

        print(io, "{")
        JSON_print_escaped(io, "name")
        print(io, ":")
        JSON_print_escaped(io, col_names[i])
        print(io, ",")
        JSON_print_escaped(io, "type")
        print(io, ":")
        JSON_print_escaped(io, julia_type_to_schema_type(col_types[i]))
        print(io, "}")
    end
    print(io, "]},")

    JSON_print_escaped(io, "data")
    print(io, ":[")

    for (row_i, row) in enumerate(source)
        if row_i>1
            print(io, ",")
        end

        print(io, "{")
        for col in 1:length(col_names)
            if col>1
                print(io, ",")
            end
            JSON_print_escaped(io, col_names[col])
            print(io, ":")
            # TODO This is not type stable, should really unroll the loop in a generated function
            JSON_print_escaped(io, row[col])
        end
        print(io, "}")
    end

    print(io, "]}")
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
