using UUIDs, Dates

include("filtering.jl")

# big numbers may fail to display properly when deserialized in JS
_is_javascript_safe(x::Real) = false

function _is_javascript_safe(x::Integer)
    min_safe_int = -(Int64(2)^53 - 1)
    max_safe_int = Int64(2)^53 - 1
    min_safe_int < x < max_safe_int
end

function _is_javascript_safe(x::AbstractFloat)
    min_safe_float = -(Float64(2)^53 - 1)
    max_safe_float = Float64(2)^53 - 1
    min_safe_float < x < max_safe_float
end

# ag-grid special cases `.` in fieldnames; we need to special case that here
col_name_fixer(name) = replace(string(name), '.' => '_')

# loading DataValues will add an overload for this
json_sprint(x) = sprint(print, x)

schema_type(::Type{Union{}}) = "string"
schema_type(::Type{T}) where {T} = "string"
schema_type(::Type{T}) where {T<:AbstractFloat} = "number"
schema_type(::Type{T}) where {T<:Integer} = "integer"
schema_type(::Type{T}) where {T<:Bool} = "boolean"
schema_type(::Type{T}) where {T<:Dates.Time} = "time"
schema_type(::Type{T}) where {T<:Dates.Date} = "date"
schema_type(::Type{T}) where {T<:Dates.DateTime} = "datetime"
schema_type(::Type{T}) where {T<:AbstractString} = "string"

julia_type(::Type{Union{}}) = nothing
julia_type(::Type{T}) where {T} = sprintlimited(T; limit=100)

ag_schema_type(::Type{Union{}}) = nothing
ag_schema_type(::Type{T}) where {T} = nothing
ag_schema_type(::Type{T}) where {T<:Number} = "numericColumn"

ag_filter_type(::Type{Union{}}) = true
ag_filter_type(::Type{T}) where {T} = true
ag_filter_type(::Type{T}) where {T<:Number} = "agNumberColumnFilter"
ag_filter_type(::Type{T}) where {T<:Union{Dates.Date,Dates.DateTime}} = "agDateColumnFilter"

# for small tables only
function print_table(io::IO, source, col_names, fixed_col_names, col_types, col_labels, title = "")
    ctx = JSON.Writer.CompactContext(io)

    JSON.begin_object(ctx)

    JSON.show_pair(ctx, JSON.StandardSerialization(), "name", title)

    JSON.show_key(ctx, "schema")
    print_schema(ctx, col_names, fixed_col_names, col_types, col_labels, filterable = true)

    JSON.show_key(ctx, "data")
    print_body(ctx, source, fixed_col_names)

    JSON.end_object(ctx)
end

# https://specs.frictionlessdata.io/table-schema
function print_schema(ctx, col_names, fixed_col_names, col_types, col_labels; filterable = false, sortable = false)
    ser = JSON.StandardSerialization()

    JSON.begin_object(ctx)
    JSON.show_key(ctx, "fields")
    JSON.begin_array(ctx)
    for i in 1:length(col_names)
        JSON.delimit(ctx)
        JSON.begin_object(ctx)
        # standard fields
        JSON.show_pair(ctx, ser, "name", fixed_col_names[i])
        JSON.show_pair(ctx, ser, "title", col_names[i])
        JSON.show_pair(ctx, ser, "type", schema_type(col_types[i]))
        # custom fields
        JSON.show_pair(ctx, ser, "jl_type", julia_type(col_types[i]))
        JSON.show_pair(ctx, ser, "jl_label", col_labels[i])
        JSON.show_pair(ctx, ser, "ag_type", ag_schema_type(col_types[i]))
        JSON.show_pair(ctx, ser, "ag_filter", filterable ? ag_filter_type(col_types[i]) : false)
        JSON.show_pair(ctx, ser, "ag_sortable", sortable)
        JSON.end_object(ctx)
    end
    JSON.end_array(ctx)
    JSON.end_object(ctx)
end

function print_body(ctx, source, fixed_col_names; first = 1, last = typemax(Int64))
    JSON.begin_array(ctx)
    i = 0
    for row in source
        i += 1
        i < first && continue
        i > last && break

        JSON.delimit(ctx)
        JSON.begin_object(ctx)
        for col = 1:length(fixed_col_names)
            print_el(ctx, fixed_col_names[col], row[col])
        end
        JSON.end_object(ctx)
    end
    JSON.end_array(ctx)
end

function print_el(ctx, name, val)
    ser = JSON.StandardSerialization()
    if val isa Real && isfinite(val) && _is_javascript_safe(val)
        JSON.show_pair(ctx, ser, name, val)
    elseif val === nothing || val === missing
        JSON.show_pair(ctx, ser, name, repr(val))
    else
        JSON.show_pair(ctx, ser, name, json_sprint(val))
    end
end

_isiterabletable = x -> false
_getiterator = x -> x
_get_label = (x, col) -> nothing

const tabletraits_uuid = UUIDs.UUID("3783bdb8-4a98-5b6b-af9a-565f29a5fe9c")
const datavalues_uuid = UUIDs.UUID("e7dc6d0d-1eca-5fa6-8ad6-5aecde8b7ea5")
const dataapi_uuid = UUIDs.UUID("9a962f9c-6df0-11e9-0e5d-c546b8b5ee8a")
function on_pkg_load(pkg)
    if pkg.uuid == tabletraits_uuid
        TableTraits = get(Base.loaded_modules, pkg) do
            Base.require(pkg)
        end

        global _isiterabletable = TableTraits.isiterabletable
        global _getiterator = TableTraits.getiterator
    elseif pkg.uuid == datavalues_uuid
        DataValues = get(Base.loaded_modules, pkg) do
            Base.require(pkg)
        end
        eval(
            quote
                function json_sprint(val::$(DataValues.DataValue))
                    $(DataValues.isna)(val) ? "null" : json_sprint(val[])
                end
            end
        )
    elseif pkg.uuid == dataapi_uuid
        DataAPI = get(Base.loaded_modules, pkg) do
            Base.require(pkg)
        end

        global _get_label = (x, col) -> try
            return DataAPI.colmetadata(x, col, "label"; style = false)
        catch err
            @debug "Could not get column label for $col" exception=(err, catch_backtrace())
            return nothing
        end
    end
end

# these assume that table elements are reasonably small
const MAX_SYNC_TABLE_ELEMENTS = 100_000
const MAX_CACHE_TABLE_ELEMENTS = 10_000_000

# make a copy of medium size tables (MAX_SYNC_TABLE_ELEMENTS < #el < MAX_CACHE_TABLE_ELEMENTS)
# store a reference for big tables
# (column_names, column_types, table_iterator, table_length, table_indexable)
const TABLES = Dict{UUID,Tuple{Any,Any,Any,Int,Bool}}()

# special-case vectors for a few known eltypes
showtable(table::AbstractVector{<:Union{Number,AbstractString,Date,DateTime,Time,AbstractVector}}, title = "") = showtable(reshape(table, :, 1), title)

function showtable(table::T, title = "") where {T}
    if showable("application/vnd.dataresource+json", table)
        return _display(InlineDisplay(), table)
    end

    iter = _getiterator(table)

    if T <: AbstractMatrix
        col_names = [string(i) for i in 1:size(table, 2)]
        col_types = [eltype(table) for _ in 1:size(table, 2)]
        # transform matrix to iterator over its rows
        iter = (view(table, i, :) for i in axes(table, 1)) # eachrow
    elseif Base.IteratorEltype(iter) isa Base.EltypeUnknown
        first_el = first(iter)
        col_names = String.(propertynames(first_el))
        col_types = [fieldtype(typeof(first_el), i) for i = 1:length(col_names)]
    else
        col_names = String.(fieldnames(eltype(iter)))
        col_types = [fieldtype(eltype(iter), i) for i = 1:length(col_names)]
    end
    fixed_col_names = col_name_fixer.(col_names)
    col_labels = [_get_label(table, colname) for colname in col_names]

    if length(fixed_col_names) == 0
        throw(ErrorException("Input table does not seem to have columns."))
    end

    if Base.haslength(iter)
        tablelength = length(iter)
        els = tablelength * length(col_names)
        async = els > MAX_SYNC_TABLE_ELEMENTS
        should_copy = els < MAX_CACHE_TABLE_ELEMENTS
        indexable = els < MAX_CACHE_TABLE_ELEMENTS
    else
        tablelength = 0
        async = true
        should_copy = false
        indexable = false
    end

    if async
        id = uuid4()
        if should_copy
            TABLES[id] = (col_names, fixed_col_names, collect(iter), tablelength, indexable)
        else
            TABLES[id] = (col_names, fixed_col_names, iter, tablelength, indexable)
        end

        io = IOBuffer()
        ctx = JSON.Writer.CompactContext(io)
        print_schema(ctx, col_names, fixed_col_names, col_types, col_labels; sortable = should_copy, filterable = should_copy)

        schema = JSON.JSONText(String(take!(io)))

        payload = (
            schema = schema,
            rowCount = tablelength,
            name = title,
            id = string(id)
        )
        sendDisplayMsg("application/vnd.dataresource+lazy", JSON.json(payload))
    else
        io = IOBuffer()
        print_table(io, iter, col_names, fixed_col_names, col_types, col_labels, title)
        sendDisplayMsg("application/vnd.dataresource+json", String(take!(io)))
    end
end

function get_table_data_request(conn, params::GetTableDataRequest, token)
    id = UUID(params.id)
    if !haskey(TABLES, id)
        return JSONRPC.JSONRPCError(-32600, "Table not found.", nothing)
    end

    col_names, fixed_col_names, table, tablelength, indexable = TABLES[id]
    will_filter = !isempty(params.filterModel)
    will_sort = !isempty(params.sortModel)

    # this will only be called for medium-sized tables
    if will_filter
        filter_hash = hash(params.filterModel)
        # we have already filtered this table with the specified filterModel
        if haskey(FILTER_CACHE, id) && first(FILTER_CACHE[id]) == filter_hash
            table = last(FILTER_CACHE[id])
        else
            filt = generate_filterer(params.filterModel, fixed_col_names)
            table = filter(r -> all(f -> f(r), filt), table)
            FILTER_CACHE[id] = (filter_hash, table)
        end
        tablelength = length(table)
    end
    if will_sort
        sort_hash = hash(params.sortModel)
        if get(SORTED_CACHE, id, 0x0) != sort_hash
            sorter = generate_sorter(params.sortModel, fixed_col_names)
            Base.invokelatest(sort!, table, lt = sorter)
            SORTED_CACHE[id] = sort_hash
        end
    end

    io = IOBuffer()
    ctx = JSON.Writer.CompactContext(io)
    if indexable
        part = isempty(table) ? table : @view table[min(params.startRow + 1, end):min(params.endRow + 1, end)]
        Base.invokelatest(print_body, ctx, part, fixed_col_names)
    else
        Base.invokelatest(print_body, ctx, table, fixed_col_names; first = params.startRow + 1, last = params.endRow + 1)
    end

    return (
        rows = JSON.JSONText(String(take!(io))),
        lastRow = tablelength
    )
end

function clear_lazy_table_notification(conn, params::NamedTuple{(:id,),Tuple{String}})
    id = UUID(params.id)
    delete!(TABLES, id)
    delete!(FILTER_CACHE, id)
    delete!(SORTED_CACHE, id)
end
