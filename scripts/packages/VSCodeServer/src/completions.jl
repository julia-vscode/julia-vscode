# completions
# -----------

using REPL.REPLCompletions
using REPL.REPLCompletions: Completion, KeywordCompletion, PathCompletion, ModuleCompletion,
    PackageCompletion, PropertyCompletion, FieldCompletion, MethodCompletion, BslashCompletion,
    ShellCompletion, DictCompletion
using InteractiveUtils: methodswith, supertypes

function repl_getcompletions_request(_, params::GetCompletionsRequestParams)
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
    dotMethods = Dict()
    if occursin(".", line)
        lineSplit = split(line, '.')
        partial = lineSplit[end]
        identifier = strip(split(lineSplit[end-1], " ")[end])
        if isdefined(mod, Symbol(identifier))
            idtype = typeof(getfield(mod, Symbol(identifier)))
            if !(idtype isa Function)
                searchInModules = Set(parentmodule.(supertypes(idtype)))
                push!(searchInModules, Base)
                availableMethods = []
                for searchModule in searchInModules
                    append!(availableMethods, methodswith(idtype, searchModule, supertypes=true))
                end
                for meth in availableMethods
                    methName = string(meth.name)
                    if occursin(partial, methName)
                        # @info "method valid: $(methName)"
                        # @info methName, NamedTuple{(:start, :end)}(((line=lineNum, character=column - length(identifier) - 1 - length(partial)),
                        #     (line=lineNum, character=column + length(methName) + 3 - length(partial))))
                        if !haskey(dotMethods, methName)
                            push!(dotMethodCompletions,
                                (
                                    label=methName,
                                    detail=string("type method completion. ", string(idtype)),
                                    kind=1,
                                    insertText="$(methName)($identifier, )",
                                    # insertText=(value = "$(methName)($identifier, \$1)"),
                                    additionalTextEdits=[(range=NamedTuple{(:start, :end)}(((line=lineNum, character=column - length(identifier) - 1), (line=lineNum, character=column))),
                                        newText="")]
                                )
                            )
                            dotMethods[methName] = 1
                        end
                    end
                end
            end

        end
    end
    replCompletions = completion.(cs, lineNum, column)
    append!(replCompletions, dotMethodCompletions)
end

repl_resolvecompletion_request(conn, completion_item) = completion_item # not used currently, return as is

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
