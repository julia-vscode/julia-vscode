using UUIDs, Dates

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

row_name_fixer(name) = replace(string(name), '.' => '_')

json_sprint(x) = sprint(print, x)
function table2json(schema, rows; requested = nothing)
    io = IOBuffer()
    rowwriter = JSON.Writer.CompactContext(io)
    JSON.begin_array(rowwriter)
    ser = JSON.StandardSerialization()
    lastrow = 0
    for (i, row) in enumerate(rows)
        lastrow = i
        if requested !== nothing
            if i < first(requested)
                continue
            end
            if i > last(requested)
                lastrow = -1
                break
            end
        end
        JSON.delimit(rowwriter)
        columnwriter = JSON.Writer.CompactContext(io)
        JSON.begin_object(columnwriter)
        _eachcolumn(schema, row) do val, _, name
            name = row_name_fixer(name)
            if val isa Real && isfinite(val) && _is_javascript_safe(val)
                JSON.show_pair(columnwriter, ser, name, val)
            elseif val === nothing || val === missing
                JSON.show_pair(columnwriter, ser, name, repr(val))
            else
                JSON.show_pair(columnwriter, ser, name, json_sprint(val))
            end
        end
        JSON.end_object(columnwriter)
    end
    JSON.end_array(rowwriter)
    String(take!(io)), lastrow
end



const MAX_SYNC_TABLE_ELEMENTS = 100_000
const TABLES = Dict{UUID, Tuple{Any, Any, Int}}()
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

    async = tablelength === nothing || tablelength*length(names) > MAX_SYNC_TABLE_ELEMENTS

    coldefs = Any[
        (
            headerName = string(n),
            headerTooltip = string(types[i]),
            field = row_name_fixer(n),
            sortable = !async,
            resizable = true,
            type = types[i] <: Union{Missing, T where T <: Number} ? "numericColumn" : nothing,
            filter = types[i] <: Union{Missing, T where T <: Union{Dates.Date, Dates.DateTime}} ? "agDateColumnFilter" :
                        types[i] <: Union{Missing, T where T <: Number} ? "agNumberColumnFilter" : true
        ) for (i, n) in enumerate(names)
    ]

    pushfirst!(coldefs, (
        headerName = "Row",
        editable = false,
        headerTooltip = "",
        field = "__row__",
        sortable = false,
        type = "numericColumn",
        cellRenderer = "rowNumberRenderer",
        resizable = true,
        filter = false,
        pinned = "left",
        lockPinned = true,
        suppressNavigable = true,
        lockPosition = true,
        suppressMovable = true,
        cellClass = "row-number-cell"
    ))

    if async
        id = uuid4()
        TABLES[id] = (schema, rows, tablelength)
        payload = (
            coldefs = coldefs,
            rowCount = tablelength,
            id = string(id)
        )
        sendDisplayMsg("application/vnd.dataresource+lazy", JSON.json(payload))
    else
        data, _ = table2json(schema, rows)
        payload = (
            coldefs = coldefs,
            data = JSON.JSONText(data),
        )
        sendDisplayMsg("application/vnd.dataresource+json", JSON.json(payload))
    end

end

showtable(table::AbstractMatrix) = _showtable(_table(table))
showtable(table::AbstractVector) = _showtable(_table(table[:, :]))
showtable(table) = _showtable(table)


const COL_START_CHAR = length("column")
function col_access(row, col)
    m = match(r"^Column(\d+)$", col)
    if m === nothing
        getproperty(row, Symbol(col))
    else
        row[parse(Int, m[1])]
    end
end

function generate_sorter(params)
    lts = []
    for sortspec in params
        let id = sortspec["colId"]
            if sortspec["sort"] == "asc"
                push!(lts, (r -> col_access(r, id), (r1, r2) -> col_access(r1, id) < col_access(r2, id)))
            else
                push!(lts, (r -> col_access(r, id), (r1, r2) -> !(col_access(r1, id) < col_access(r2, id))))
            end
        end
    end
    function (row1, row2)
        lt = false
        for (accessor, ltf) in lts
            if ltf(row1, row2)
                return true
            end
            if accessor(row1) != accessor(row2)
                return false
            end
        end
        return lt
    end
end

const filterMapping = Dict{String, Function}(
    "equals" => ==,
    "notEqual" => !=,
    "lessThan" => <,
    "lessThanOrEqual" => <=,
    "greaterThan" => >,
    "greaterThanOrEqual" => >=,
)

function generate_filter(params, col)
    filter_type = params["filterType"]
    if filter_type == "number"
        generate_number_filter(params, col)
    elseif filter_type == "text"
        generate_text_filter(params, col)
    elseif filter_type == "date"
        generate_date_filter(params, col)
    else
        (args...) -> true
    end
end

function generate_number_filter(params, col)
    row -> filterMapping[params["type"]](col_access(row, col), params["filter"])
end

function regex_escape(s::AbstractString)
    res = replace(s, r"([()[\]{}?*+\-|^\$\\.&~#\s=!<>|:])" => s"\\\1")
    replace(res, "\0" => "\\0")
end

function generate_string_filter(params, col)
    filtervalue = regex_escape(params["filter"])
    op = params["type"]
    if op == "equals"
        matcher = Regex("^" * filtervalue * "\$", "i")
        row -> occursin(matcher, col_access(row, col))
    elseif op == "notEqual"
        matcher = Regex("^" * filtervalue * "\$", "i")
        row -> !occursin(matcher, col_access(row, col))
    elseif op == "startsWith"
        matcher = Regex("^" * filtervalue, "i")
        row -> occursin(matcher, col_access(row, col))
    elseif op == "endsWith"
        matcher = Regex(filtervalue * "\$", "i")
        row -> occursin(matcher, col_access(row, col))
    elseif op == "contains"
        matcher = Regex(filtervalue, "i")
        row -> occursin(matcher, col_access(row, col))
    elseif op == "notContains"
        matcher = Regex(filtervalue, "i")
        row -> !occursin(matcher, col_access(row, col))
    end
end

function generate_date_filter(params, col)
    format = dateformat"y-m-d H:M:S"
    dateFrom = Date(params["dateFrom"], format)

    op = params["type"]

    if op == "inRange"
        dateTo = Date(params["dateTo"], format)

        row -> >(col_access(row, col), dateFrom) && <(col_access(row, col), dateTo)
    else
        row -> filterMapping[op](col_access(row, col), dateFrom)
    end
end

function generate_bool(op, cond1, cond2, col)
    let f1 = generate_filter(cond1, col), f2 = generate_filter(cond2, col)
        if op == "AND"
            (args...) -> f1(args...) && f2(args...)
        else
            (args...) -> f1(args...) || f2(args...)
        end
    end
end

function generate_filterer(filters::Dict)
    funcs = Function[]
    for (col, filter) in filters
        op = get(filter, "operator", "")
        if op in ("AND", "OR")
            push!(funcs, generate_bool(op, filter["condition1"], filter["condition2"], col))
        else
            push!(funcs, generate_filter(filter, col))
        end
    end
    return funcs
end

function get_table_data(conn, params::GetTableDataRequest)
    schema, table, rowCount = get(TABLES, UUID(params.id), (nothing, nothing, nothing))
    if !isempty(params.filterModel)
        filt = generate_filterer(params.filterModel)
        table = Base.Iterators.filter(r -> all(f -> f(r), filt), table)
    end
    if !isempty(params.sortModel)
        if applicable(sort, table)
            sorter = generate_sorter(params.sortModel)
            table = Base.invokelatest(sort, table, lt = sorter)
        else
            @warn "This table is not sortable."
        end
    end
    if table === nothing
        return JSONRPC.JSONRPCError(-32600, "Table not found.", nothing)
    else
        data, lastrow = try
            data, lastrow = Base.invokelatest(table2json, schema, table; requested = (params.startRow + 1):(params.endRow + 1))
            JSON.JSONText(data), lastrow == -1 ? rowCount : lastrow
        catch err
            @debug "Error getting table data." exception=(err, catch_backtrace())
            return JSONRPC.JSONRPCError(-32600, "Could not iterate over table.", nothing)
        end
        return (
            rows = data,
            lastRow = lastrow
        )
    end
end

function clear_lazy_table(conn, params::NamedTuple{(:id,), Tuple{String}})
    delete!(TABLES, UUID(params.id))
end

function try_display_table(x)
    if showable("application/vnd.dataresource+json", x)
        _display(InlineDisplay(), x)
        return true
    end

    if _isiterabletable(x) === true &&
        buffer = IOBuffer()
        io = IOContext(buffer, :compact => true)
        printdataresource(io, _getiterator(x))
        buffer_asstring = CachedDataResourceString(String(take!(buffer)))
        _display(InlineDisplay(), buffer_asstring)
        return true
    elseif _isiterabletable(x) === missing
        try
            buffer = IOBuffer()
            io = IOContext(buffer, :compact => true)
            printdataresource(io, _getiterator(x))
            buffer_asstring = CachedDataResourceString(String(take!(buffer)))
            _display(InlineDisplay(), buffer_asstring)
            return true
        catch err
            return false
        end
    elseif x isa AbstractVector || x isa AbstractMatrix
        buffer = IOBuffer()
        io = IOContext(buffer, :compact => true)
        print_array_as_dataresource(io, _getiterator(x))
        buffer_asstring = CachedDataResourceString(String(take!(buffer)))
        _display(InlineDisplay(), buffer_asstring)
        return true
    else
        return false
    end
end
