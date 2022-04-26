const FILTER_CACHE = Dict{UUID, Tuple{UInt64, Any}}()
const SORTED_CACHE = Dict{UUID, UInt64}()

col_access(row, col) = row[col]

function generate_sorter(params, fixed_col_names)
    lts = []
    for sortspec in params
        let col = sortspec["colId"]
            ind = findfirst(==(col), fixed_col_names)
            if ind === nothing
                continue
            end
            if sortspec["sort"] == "asc"
                push!(lts, (r -> col_access(r, ind), (r1, r2) -> col_access(r1, ind) < col_access(r2, ind)))
            else
                push!(lts, (r -> col_access(r, ind), (r1, r2) -> !(col_access(r1, ind) < col_access(r2, ind))))
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
        generate_string_filter(params, col)
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
        row -> occursin(matcher, string(col_access(row, col)))
    elseif op == "notEqual"
        matcher = Regex("^" * filtervalue * "\$", "i")
        row -> !occursin(matcher, string(col_access(row, col)))
    elseif op == "startsWith"
        matcher = Regex("^" * filtervalue, "i")
        row -> occursin(matcher, string(col_access(row, col)))
    elseif op == "endsWith"
        matcher = Regex(filtervalue * "\$", "i")
        row -> occursin(matcher, string(col_access(row, col)))
    elseif op == "contains"
        matcher = Regex(filtervalue, "i")
        row -> occursin(matcher, string(col_access(row, col)))
    elseif op == "notContains"
        matcher = Regex(filtervalue, "i")
        row -> !occursin(matcher, string(col_access(row, col)))
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

function generate_filterer(filters::Dict, fixed_col_names)
    funcs = Function[]
    for (col, filter) in filters
        ind = findfirst(==(col), fixed_col_names)
        if ind === nothing
            continue
        end
        op = get(filter, "operator", "")
        if op in ("AND", "OR")
            push!(funcs, generate_bool(op, filter["condition1"], filter["condition2"], ind))
        else
            push!(funcs, generate_filter(filter, ind))
        end
    end
    return funcs
end
