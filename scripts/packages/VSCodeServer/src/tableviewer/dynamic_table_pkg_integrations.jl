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
elseif _isiterabletable(table)
    _getiterator(table)
else
    table
end
_schema = table -> nothing
_Schema = (names, types) -> (
    names = names,
    types = types
)
_table = identity
_istable = x -> x isa AbstractVecOrMat

_isiterabletable = x -> false
_getiterator = x -> x
_supports_get_columns_copy_using_missing = x -> false
_get_columns_copy_using_missing = x -> error("TableTraits.jl is not loaded.")

const tables_uuid = UUIDs.UUID("bd369af6-aec1-5ad0-b16a-f7cc5008161c")
const tabletraits_uuid = UUIDs.UUID("3783bdb8-4a98-5b6b-af9a-565f29a5fe9c")
const datavalues_uuid = UUIDs.UUID("e7dc6d0d-1eca-5fa6-8ad6-5aecde8b7ea5")

function on_pkg_load(pkg)
    if pkg.uuid == tables_uuid
        Tables = Base.require(pkg)

        global _eachcolumn = Tables.eachcolumn
        global _schema = Tables.schema
        global _rows = Tables.rows
        global _Schema = Tables.Schema
        global _table = Tables.table
        global _istable = Tables.istable
    elseif pkg.uuid == tabletraits_uuid
        TableTraits = Base.require(pkg)

        global _isiterabletable = TableTraits.isiterabletable
        global _getiterator = TableTraits.IteratorInterfaceExtensions.getiterator

        if isdefined(TableTraits, :supports_get_columns_copy_using_missing)
            global _supports_get_columns_copy_using_missing = TableTraits.supports_get_columns_copy_using_missing
            global _get_columns_copy_using_missing = TableTraits.get_columns_copy_using_missing
        end
    elseif pkg.uuid == datavalues_uuid
        DataValues = Base.require(pkg)

        eval(
            quote
                function json_sprint(val::$(DataValues.DataValue))
                    $(DataValues.isna)(val) ? "null" : json_sprint(val[])
                end

                array_factory_for_tables(t<:$(DataValues.DataValue), rows) = Vector{Union{eltype(t),Missing}}(undef, rows)
            end
        )
    end
end
