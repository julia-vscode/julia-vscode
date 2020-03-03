module _vscodeserver

include("repl.jl")

function remlineinfo!(x)
    if isa(x, Expr)
        if x.head == :macrocall && x.args[2] != nothing
            id = findall(map(x -> (isa(x, Expr) && x.head == :line) || (isdefined(:LineNumberNode) && x isa LineNumberNode), x.args))
            deleteat!(x.args, id)
            for j in x.args
                remlineinfo!(j)
            end
            insert!(x.args, 2, nothing)
        else
            id = findall(map(x -> (isa(x, Expr) && x.head == :line) || (isdefined(:LineNumberNode) && x isa LineNumberNode), x.args))
            deleteat!(x.args, id)
            for j in x.args
                remlineinfo!(j)
            end
        end
    end
    x
end

using REPL, Sockets, Base64, Pkg, UUIDs
import Base: display, redisplay
import Dates
global active_module = :Main

struct InlineDisplay <: AbstractDisplay end

pid = Base.ARGS[1]

function change_module(newmodule::String, print_change = true)
    global active_module
    smods = Symbol.(split(newmodule, "."))

    val = Main
    for i = 1:length(smods)
        if isdefined(val, smods[i])
            val = getfield(val, smods[i])
        else
            println("Could not find module $newmodule")
            return
        end
    end
    expr = Meta.parse(newmodule)
    active_module = expr
    repl = Base.active_repl
    main_mode = repl.interface.modes[1]
    main_mode.prompt = string(newmodule,"> ")
    main_mode.on_done = REPL.respond(repl,main_mode; pass_empty = false) do line
        if !isempty(line)
            ex = Meta.parse(line)
            if ex isa Expr && ex.head == :module
                ret = :( Base.eval($expr, Expr(:(=), :ans, Expr(:toplevel, Meta.parse($line)))) )
            else
                ret = :( Core.eval($expr, Expr(:(=), :ans, Meta.parse($line))) )
            end
        else
            ret = :(  )
        end
        sendMsgToVscode("repl/variables", getVariables())
        return ret
    end
    print(" \r ")
    print_change && println("Changed root module to $expr")
    printstyled(string(newmodule,"> "), bold = true, color = :green)
end

function get_available_modules(m=Main, out = Module[])
    for n in names(m, all = true, imported = true)
        if isdefined(m, n) && getfield(m, n) isa Module  && !(getfield(m, n) in out)
            M = getfield(m, n)
            push!(out, M)
            get_available_modules(M, out)
        end
    end
    out
end

function getVariables()
    M = @__MODULE__
    variables = []
    msg = ""
    for n in names(M)
        !isdefined(M, n) && continue
        x = getfield(M, n)
        t = typeof(x)
        msg = string(msg, ";", n, "::", t)
    end
    return msg
end

function generate_pipe_name(name)
    if Sys.iswindows()
        "\\\\.\\pipe\\vscode-language-julia-$name-$pid"
    elseif Sys.isunix()
        joinpath(tempdir(), "vscode-language-julia-$name-$pid")
    end
end

!(Sys.isunix() || Sys.iswindows()) && error("Unknown operating system.")

pipename_fromrepl = generate_pipe_name("fromrepl")
pipename_torepl = generate_pipe_name("torepl")

if issocket(pipename_torepl)
    rm(pipename_torepl)
end



function sendMsgToVscode(cmd, payload)
    println(conn, cmd, ":", sizeof(payload))
    print(conn, payload)
end

function ends_with_semicolon(x)
    return REPL.ends_with_semicolon(split(x,'\n',keepempty = false)[end])
end

@async begin
    server = listen(pipename_torepl)
    global conn = connect(pipename_fromrepl)
    while true
        sock = accept(server)
        header = readline(sock)
        cmd, payload_size_asstring = split(header, ':')
        payload_size = parse(Int, payload_size_asstring)
        payload = read(sock, payload_size)
        if cmd == "repl/include"
            text = String(payload)
            cmod = Core.eval(active_module)
            ex = Expr(:call, :include, strip(text, '\n'))
            cmod.eval(ex)
        elseif cmd == "repl/getVariables"
            sendMsgToVscode("repl/variables", getVariables())
        elseif cmd == "debug/info"
            @info "RECEIVED A debug/info message"
            @info "With payload_size=$payload_size"
            @info String(payload)
        elseif cmd == "repl/runcode"
            payload_as_string = String(payload)
            end_first_line_pos = findfirst("\n", payload_as_string)[1]
            end_second_line_pos = findnext("\n", payload_as_string, end_first_line_pos+1)[1]

            source_filename = payload_as_string[1:end_first_line_pos-1]
            code_line, code_column = parse.(Int, split(payload_as_string[end_first_line_pos+1:end_second_line_pos-1], ':'))
            source_code = payload_as_string[end_second_line_pos+1:end]

            hideprompt() do
                if isdefined(Main, :Revise) && isdefined(Main.Revise, :revise) && Main.Revise.revise isa Function
                    let mode = get(ENV, "JULIA_REVISE", "auto")
                        mode == "auto" && Main.Revise.revise()
                    end
                end
                # println(' '^code_column * source_code)

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
        end
    end
end

function display(d::InlineDisplay, ::MIME{Symbol("image/png")}, x)
    payload = stringmime(MIME("image/png"), x)
    sendMsgToVscode("image/png", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("image/png")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("image/svg+xml")}, x)
    payload = stringmime(MIME("image/svg+xml"), x)
    sendMsgToVscode("image/svg+xml", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("image/svg+xml")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("text/html")}, x)
    payload = stringmime(MIME("text/html"), x)
    sendMsgToVscode("text/html", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("text/html")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("juliavscode/html")}, x)
    payload = stringmime(MIME("juliavscode/html"), x)
    sendMsgToVscode("juliavscode/html", payload)
end

Base.Multimedia.istextmime(::MIME{Symbol("juliavscode/html")}) = true

displayable(d::InlineDisplay, ::MIME{Symbol("juliavscode/html")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v2+json")}, x)
    payload = stringmime(MIME("application/vnd.vegalite.v2+json"), x)
    sendMsgToVscode("application/vnd.vegalite.v2+json", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v2+json")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v3+json")}, x)
    payload = stringmime(MIME("application/vnd.vegalite.v3+json"), x)
    sendMsgToVscode("application/vnd.vegalite.v3+json", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v3+json")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v4+json")}, x)
    payload = stringmime(MIME("application/vnd.vegalite.v4+json"), x)
    sendMsgToVscode("application/vnd.vegalite.v4+json", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.vegalite.v4+json")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.vega.v3+json")}, x)
    payload = stringmime(MIME("application/vnd.vega.v3+json"), x)
    sendMsgToVscode("application/vnd.vega.v3+json", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.vega.v3+json")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.vega.v4+json")}, x)
    payload = stringmime(MIME("application/vnd.vega.v4+json"), x)
    sendMsgToVscode("application/vnd.vega.v4+json", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.vega.v4+json")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.vega.v5+json")}, x)
    payload = stringmime(MIME("application/vnd.vega.v5+json"), x)
    sendMsgToVscode("application/vnd.vega.v5+json", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.vega.v5+json")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.plotly.v1+json")}, x)
    payload = stringmime(MIME("application/vnd.plotly.v1+json"), x)
    sendMsgToVscode("application/vnd.plotly.v1+json", payload)
end

displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.dataresource+json")}) = true

function display(d::InlineDisplay, ::MIME{Symbol("application/vnd.dataresource+json")}, x)
    payload = stringmime(MIME("application/vnd.dataresource+json"), x)
    sendMsgToVscode("application/vnd.dataresource+json", payload)
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
load_revise = Base.ARGS[2] == "true" && (VERSION < v"1.1" ? haskey(Pkg.Types.Context().env.manifest, "Revise") : haskey(Pkg.Types.Context().env.project.deps, "Revise"))

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
    @eval using Revise
    Revise.async_steal_repl_backend()
end
