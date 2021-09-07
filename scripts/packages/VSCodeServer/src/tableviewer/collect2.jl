array_factory_for_tables(t, rows) = Vector{t}(undef, rows)

function create_missing_columns_from_iterabletable(itr)
    if _isiterabletable(itr) === false
        throw(ArgumentError("`itr` is not a table."))
    end

    itr2 = _getiterator(itr)

    return _collect_columns(itr2, Base.IteratorSize(itr2))
end

function collect_empty_columns(itr::T, ::Base.EltypeUnknown) where {T}
    S = Core.Compiler.return_type(first, Tuple{T})
    if S == Union{} || !(S <: NamedTuple)
        throw(ArgumentError("itr is not a table."))
    end
    dest = getdest(S, 0)
    return collect(values(dest)), collect(keys(dest))
end

function collect_empty_columns(itr::T, ::Base.HasEltype) where {T}
    if eltype(itr) <: NamedTuple
        dest = getdest(eltype(itr), 0)
        return collect(values(dest)), collect(keys(dest))
    else
        throw(ArgumentError("itr is not a table."))
    end
end

function getdest(T, n)
    return NamedTuple{fieldnames(T)}(tuple((array_factory_for_tables(fieldtype(T, i), n) for i in 1:length(fieldnames(T)))...))
end

@generated function _setrow(dest::NamedTuple{NAMES,TYPES}, i, el::T) where {T,NAMES,TYPES}
    push_exprs = Expr(:block)
    for col_idx in 1:length(fieldnames(T))
        if fieldtype(TYPES, col_idx) !== Nothing
            if fieldtype(TYPES, col_idx) == Array{Any,1} && fieldtype(T, col_idx) == DataValue{Any}
                ex = :( dest[$col_idx][i] = get(el[$col_idx], missing) )
            else
                ex = :( dest[$col_idx][i] = el[$col_idx] )
            end
            push!(push_exprs.args, ex)
        end
    end

    return push_exprs
end

@generated function _pushrow(dest::NamedTuple{NAMES,TYPES}, el::T) where {T,NAMES,TYPES}
    push_exprs = Expr(:block)
    for col_idx in 1:length(fieldnames(T))
        if fieldtype(TYPES, col_idx) !== Nothing
            if fieldtype(TYPES, col_idx) == Array{Any,1} && fieldtype(T, col_idx) == DataValue{Any}
                ex = :( push!(dest[$col_idx], get(el[$col_idx], missing)) )
            else
                ex = :( push!(dest[$col_idx], el[$col_idx]) )
            end
            push!(push_exprs.args, ex)
        end
    end

    return push_exprs
end

function _collect_columns(itr, ::Union{Base.HasShape,Base.HasLength})
    y = iterate(itr)
    y === nothing && return collect_empty_columns(itr, Base.IteratorEltype(itr))

    if !(typeof(y[1]) <: NamedTuple)
        throw(ArgumentError("itr is not a table."))
    end

    dest = getdest(typeof(y[1]), length(itr))

    _setrow(dest, 1, y[1])

    _collect_to_columns!(dest, itr, 2, y[2])
end

function _collect_to_columns!(dest::T, itr, offs, st) where {T <: NamedTuple}
    i = offs
    y = iterate(itr, st)
    while y !== nothing
        _setrow(dest, i, y[1])
        i += 1
        y = iterate(itr, y[2])
    end

    return collect(values(dest)), collect(keys(dest))
end

function _collect_columns(itr, ::Base.SizeUnknown)
    y = iterate(itr)
    y === nothing && return collect_empty_columns(itr, Base.IteratorEltype(itr))

    if !(typeof(y[1]) <: NamedTuple)
        throw(ArgumentError("itr is not a table."))
    end

    dest = getdest(typeof(y[1]), 1)

    _setrow(dest, 1, y[1])

    _grow_to_columns!(dest, itr, y[2])
end

function _grow_to_columns!(dest::T, itr, st) where {T <: NamedTuple}
    y = iterate(itr, st)
    while y !== nothing
        _pushrow(dest, y[1])
        y = iterate(itr, y[2])
    end

    return collect(values(dest)), collect(keys(dest))
end
