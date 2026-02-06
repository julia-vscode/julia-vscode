# completions
# -----------

using REPL.REPLCompletions
using REPL.REPLCompletions: Completion, KeywordCompletion, PathCompletion, ModuleCompletion,
    PackageCompletion, PropertyCompletion, FieldCompletion, MethodCompletion, BslashCompletion,
    ShellCompletion, DictCompletion, non_identifier_chars
using InteractiveUtils: methodswith, supertypes

function repl_getcompletions_request(_, params::GetCompletionsRequestParams, token)
    mod, line = params.mod, params.line
    lineNum, column = params.lineNum, params.column
    mod = module_from_string(mod)

    cs = try
        first(Base.invokelatest(completions, line, lastindex(line), mod))
    catch err
        @debug "completion error" exception = (err, catch_backtrace())
        # might error when e.g. type inference fails
        Completion[]
    end
    filter!(is_target_completion, cs)

    dotMethodCompletions = []
    if occursin(".", line)
        lineSplit = rsplit(line, '.', limit=2)
        partial = lineSplit[end]
        identifier = strip(lineSplit[end-1], non_identifier_chars)
        identifierSplit = split(identifier, ".")
        parentIdentifier = identifier
        if length(identifierSplit) > 1
            parentIdentifier = identifierSplit[1]
        end
        if Base.invokelatest(isdefined, mod, Symbol(parentIdentifier))
            idtype = nothing
            if length(identifierSplit) > 1
                parentI = Base.invokelatest(getfield, mod, Symbol(parentIdentifier))
                getSubI = parentI
                subIFound = true
                for subI in identifierSplit[2:end]
                    if Base.invokelatest(hasproperty, getSubI, Symbol(subI))
                        getSubI = Base.invokelatest(getproperty, getSubI, Symbol(subI))
                    else
                        subIFound = false
                        break
                    end
                end
                if subIFound
                    idtype = typeof(getSubI)
                end
            else
                idtype = typeof(Base.invokelatest(getfield, mod, Symbol(identifier)))
            end
            if !isnothing(idtype) && !(idtype isa Function)
                supertypesOfid =  Base.invokelatest(supertypes, idtype)
                if length(supertypesOfid) > 1
                    supertypesOfid = supertypesOfid[1:end-1]
                end
                searchInModules = Set(parentmodule.(supertypesOfid))
                push!(searchInModules, Base)
                availableMethods = []
                availMethodsLock = ReentrantLock()
                Threads.@threads for searchModule in collect(searchInModules)
                    aMethods = methodswith(idtype, searchModule, supertypes=true)
                    lock(availMethodsLock)
                    append!(availableMethods, aMethods)
                    unlock(availMethodsLock)
                end
                for meth in availableMethods
                    methName = string(meth.name)
                    if occursin(partial, methName)
                        preComma = ""
                        detailMeth = string(meth.module) * ": " * string(meth.sig)
                        if hasproperty(meth.sig, :parameters)
                            idIndex = findfirst(in(supertypesOfid), meth.sig.parameters)
                            if isnothing(idIndex)
                                idIndex = 0
                            end
                            preComma = ","^clamp(idIndex - 2, 0, 100)
                            detailMeth = string(meth.module) * ": $(meth.name)" * string(meth.sig.parameters[2:end])[5:end]
                        end
                        push!(dotMethodCompletions,
                            (
                                label=methName,
                                detail=detailMeth,
                                kind=1,
                                insertText="$(methName)($preComma$identifier, )",
                                # insertText=(value = "$(methName)($identifier, \$1)"),
                                additionalTextEdits=[(range=NamedTuple{(:start, :end)}(((line=lineNum, character=column - length(identifier) - 1), (line=lineNum, character=column))),
                                    newText="")]
                            )
                        )
                    end
                end
            end

        end
    end
    replCompletions = completion.(cs, lineNum, column)
    append!(replCompletions, dotMethodCompletions)
end

function repl_resolvecompletion_request(conn, completion_item, token)
    return completion_item # not used currently, return as is
end

function is_target_completion(c)
    return c isa PropertyCompletion ||
           c isa FieldCompletion ||
           c isa DictCompletion
end

completion(c, lineNum, column) = (
    label=completion_label(c),
    detail=string("REPL completion. ", completion_detail(c)),
    kind=completion_kind(c),
    insertText=completion_label(c),
    # insertText=(value = completion_label(c)),
    # range=NamedTuple{(:start, :end)}(((line=lineNum, character=column),
    #     (line=lineNum, character=column)))
    additionalTextEdits=[(range=NamedTuple{(:start, :end)}(((line=lineNum, character=column), (line=lineNum, character=column))),
        newText="")]
)

completion_label(c) = completion_text(c)
completion_label(c::DictCompletion) = rstrip(completion_text(c), (']', '"'))

completion_detail(c::PropertyCompletion) = begin
    hasproperty(c.value, c.property) || return ""
    isdefined(c.value, c.property) || return "#undef"
    t = typeof(getproperty(c.value, c.property))
    string(t)
end
completion_detail(c::FieldCompletion) = string(fieldtype(c.typ, c.field))
completion_detail(c::DictCompletion) = string(valtype(c.dict))
completion_detail(c) = ""

# always mark these completions as Events to distinguish them from LS completions
completion_kind(c) = 22
