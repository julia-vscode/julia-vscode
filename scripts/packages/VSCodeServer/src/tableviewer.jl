using UUIDs

struct IteratorAndFirst{F, T}
    first::F
    source::T
    len::Int
    function IteratorAndFirst(x)
        len = Base.haslength(x) ? length(x) : 0
        first = iterate(x)
        return new{typeof(first), typeof(x)}(first, x, len)
    end
    function IteratorAndFirst(first, x)
        len = Base.haslength(x) ? length(x) + 1 : 1
        return new{typeof(first), typeof(x)}(first, x, len)
    end
end
Base.IteratorSize(::Type{IteratorAndFirst{F, T}}) where {F, T} = Base.IteratorSize(T)
Base.length(x::IteratorAndFirst) = x.len
Base.IteratorEltype(::Type{IteratorAndFirst{F, T}}) where {F, T} = Base.IteratorEltype(T)
Base.eltype(x::IteratorAndFirst) = eltype(x.source)
Base.iterate(x::IteratorAndFirst) = x.first
function Base.iterate(x::IteratorAndFirst, st)
    st === nothing && return nothing
    return iterate(x.source, st)
end

_is_javascript_safe(x::Real) = false

function _is_javascript_safe(x::Integer)
    min_safe_int = -(Int64(2)^53-1)
    max_safe_int = Int64(2)^53-1
    min_safe_int < x < max_safe_int
end

function _is_javascript_safe(x::AbstractFloat)
    min_safe_float = -(Float64(2)^53-1)
    max_safe_float = Float64(2)^53-1
    min_safe_float < x < max_safe_float
end

function table2json(schema, rows; requested = nothing)
    io = IOBuffer()
    rowwriter = JSON.Writer.CompactContext(io)
    JSON.begin_array(rowwriter)
    ser = JSON.StandardSerialization()
    for (i, row) in enumerate(rows)
        if requested !== nothing && (i < first(requested) || i > last(requested))
            continue
        end
        JSON.delimit(rowwriter)
        columnwriter = JSON.Writer.CompactContext(io)
        JSON.begin_object(columnwriter)
        _eachcolumn(schema, row) do val, _, name
            if val isa Real && isfinite(val) && _is_javascript_safe(val)
                JSON.show_pair(columnwriter, ser, name, val)
            elseif val === nothing || val === missing
                JSON.show_pair(columnwriter, ser, name, repr(val))
            else
                JSON.show_pair(columnwriter, ser, name, sprint(print, val))
            end
        end
        JSON.end_object(columnwriter)
    end
    JSON.end_array(rowwriter)
    String(take!(io))
end

const tables_uuid = UUIDs.UUID("bd369af6-aec1-5ad0-b16a-f7cc5008161c")

_eachcolumn = (f, schema, row) -> begin
    props = propertynames(row)
    if isempty(props)
        for (i, el) in enumerate(row)
            f(el, i, Symbol("Column", i))
        end
    else
        for (i, nm) in enumerate(props)
            f(getproperty(row, nm), i, nm)
        end
    end
end
_rows = table -> if table isa Matrix
    (table[i, :] for i in 1:size(table, 1))
else
    table
end
_schema = table -> nothing
_Schema = (names, types) -> (
    names = names,
    types = types
)

function get_tables_jl(pkg)
    if pkg.uuid == tables_uuid
        Tables = Base.require(pkg)

        global _eachcolumn = Tables.eachcolumn
        global _schema = Tables.schema
        global _rows = Tables.rows
        global _Schema = Tables.Schema
    end
end

# const TABLES = Dict{UUID, Tuple{Any, WeakRef}}()
const TABLES = Dict{UUID, Tuple{Any, Any, Union{Nothing, Int}}}()
function _showtable(table)
    rows = _rows(table)
    it_sz = Base.IteratorSize(rows)
    has_len = it_sz isa Base.HasLength || it_sz isa Base.HasShape
    tablelength = has_len ? length(rows) : nothing
    schema = _schema(rows)

    if schema === nothing
        st = iterate(rows)
        rows = IteratorAndFirst(st, rows)
        names = Symbol[]
        types = []
        if st !== nothing
            row = st[1]
            props = propertynames(row)
            if isempty(props)
                for (i, el) in enumerate(row)
                    push!(names, Symbol("Column", i))
                    push!(types, typeof(el))
                end
            else
                for nm in props
                    push!(names, nm)
                    push!(types, typeof(getproperty(row, nm)))
                end
            end
            schema = _Schema(names, types)
        else
            # no schema and no rows
        end
    else
        names = schema.names
        types = schema.types
    end

    async = tablelength === nothing || tablelength*length(names) > 10_000

    coldefs = [
        (
            headerName = string(n),
            headerTooltip = string(types[i]),
            field = string(n),
            sortable = !async,
            resizable = true,
            type = types[i] <: Union{Missing, T where T <: Number} ? "numericColumn" : nothing,
            filter = async ? false : types[i] <: Union{Missing, T where T <: Dates.Date} ? "agDateColumnFilter" :
                        types[i] <: Union{Missing, T where T <: Number} ? "agNumberColumnFilter" : true
        ) for (i, n) in enumerate(names)
    ]

    if async
        id = uuid4()
        TABLES[id] = (schema, table, tablelength)
        payload = (
            coldefs = coldefs,
            rowCount = tablelength,
            id = string(id)
        )
        sendDisplayMsg("application/vnd.dataresource+lazy", JSON.json(payload))
    else
        payload = (
            coldefs = coldefs,
            data = JSON.JSONText(table2json(schema, rows)),
        )
        sendDisplayMsg("application/vnd.dataresource+json", JSON.json(payload))
    end

end

function get_table_data(conn, params::NamedTuple{(:id,:startRow,:endRow),Tuple{String, Int, Int}})
    schema, table, numRows = TABLES[UUID(params.id)]
    if table === nothing
        return (
            error = "Error.",
        )
    else
        return (
            rows = JSON.JSONText(Base.invokelatest(table2json, schema, table; requested = (params.startRow + 1):(params.endRow + 1))),
            lastRow = numRows
        )
    end
end
