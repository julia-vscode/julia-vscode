
struct CachedDataResourceString
    content::String
end
Base.show(io::IO, ::MIME"application/vnd.dataresource+json", source::CachedDataResourceString) = print(io, source.content)
Base.showable(::MIME"application/vnd.dataresource+json", dt::CachedDataResourceString) = true

function JSON_print_escaped(io, val::AbstractString)
    print(io, '"')
    for c in val
        if c == '"' || c == '\\'
            print(io, '\\')
            print(io, c)
        elseif c == '\b'
            print(io, '\\')
            print(io, 'b')
        elseif c == '\f'
            print(io, '\\')
            print(io, 'f')
        elseif c == '\n'
            print(io, '\\')
            print(io, 'n')
        elseif c == '\r'
            print(io, '\\')
            print(io, 'r')
        elseif c == '\t'
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
julia_type_to_schema_type(::Type{T}) where {T <: AbstractFloat} = "number"
julia_type_to_schema_type(::Type{T}) where {T <: Integer} = "integer"
julia_type_to_schema_type(::Type{T}) where {T <: Bool} = "boolean"
julia_type_to_schema_type(::Type{T}) where {T <: Dates.Time} = "time"
julia_type_to_schema_type(::Type{T}) where {T <: Dates.Date} = "date"
julia_type_to_schema_type(::Type{T}) where {T <: Dates.DateTime} = "datetime"
julia_type_to_schema_type(::Type{T}) where {T <: AbstractString} = "string"

function printdataresource(io::IO, source)
    if Base.IteratorEltype(source) isa Base.EltypeUnknown
        first_el = first(source)
        col_names = String.(propertynames(first_el))
        col_types = [fieldtype(typeof(first_el), i) for i = 1:length(col_names)]
    else
        col_names = String.(fieldnames(eltype(source)))
        col_types = [fieldtype(eltype(source), i) for i = 1:length(col_names)]
    end

    print(io, "{")

    JSON_print_escaped(io, "schema")
    print(io, ": {")
    JSON_print_escaped(io, "fields")
    print(io, ":[")
    for i = 1:length(col_names)
        if i > 1
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
        if row_i > 1
            print(io, ",")
        end

        print(io, "{")
        for col in 1:length(col_names)
            if col > 1
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

function print_array_as_dataresource(io::IO, source::T) where {EL,T <: AbstractVector{EL}}
    print(io, "{")

    JSON_print_escaped(io, "schema")
    print(io, ": {")
    JSON_print_escaped(io, "fields")
    print(io, ":[")

    print(io, "{")
    JSON_print_escaped(io, "name")
    print(io, ":")
    JSON_print_escaped(io, "values")
    print(io, ",")
    JSON_print_escaped(io, "type")
    print(io, ":")
    JSON_print_escaped(io, julia_type_to_schema_type(EL))
    print(io, "}")

    print(io, "]},")

    JSON_print_escaped(io, "data")
    print(io, ":[")

    for (row_i, row) in enumerate(source)
        if row_i > 1
            print(io, ",")
        end

        print(io, "{")
        JSON_print_escaped(io, "values")
        print(io, ":")
        # TODO This is not type stable, should really unroll the loop in a generated function
        JSON_print_escaped(io, row)
        print(io, "}")
    end

    print(io, "]}")
end

function print_array_as_dataresource(io::IO, source::T) where {EL,T <: AbstractMatrix{EL}}
    nrow, ncol = size(source)

    print(io, "{")

    JSON_print_escaped(io, "schema")
    print(io, ": {")
    JSON_print_escaped(io, "fields")
    print(io, ":[")
    for i = 1:ncol
        if i > 1
            print(io, ",")
        end

        print(io, "{")
        JSON_print_escaped(io, "name")
        print(io, ":")
        JSON_print_escaped(io, string(i))
        print(io, ",")
        JSON_print_escaped(io, "type")
        print(io, ":")
        JSON_print_escaped(io, julia_type_to_schema_type(EL))
        print(io, "}")
    end
    print(io, "]},")

    JSON_print_escaped(io, "data")
    print(io, ":[")

    for row_i in 1:nrow
        if row_i > 1
            print(io, ",")
        end

        print(io, "{")
        for col_i in 1:ncol
            if col_i > 1
                print(io, ",")
            end
            JSON_print_escaped(io, string(col_i))
            print(io, ":")
            # TODO This is not type stable, should really unroll the loop in a generated function
            JSON_print_escaped(io, source[row_i, col_i])
        end
        print(io, "}")
    end

    print(io, "]}")
end
