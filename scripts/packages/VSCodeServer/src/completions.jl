# completions
# -----------

using REPL.REPLCompletions
using REPL.REPLCompletions: Completion, KeywordCompletion, PathCompletion, ModuleCompletion,
    PackageCompletion, PropertyCompletion, FieldCompletion, MethodCompletion, BslashCompletion,
    ShellCompletion, DictCompletion

function repl_getcompletions_request(_, params::GetCompletionsRequestParams, token)
    mod, line = params.mod, params.line
    mod = module_from_string(mod)

    cs = try
        first(Base.invokelatest(completions, line, lastindex(line), mod))
    catch err
        @debug "completion error" exception=(err, catch_backtrace())
        # might error when e.g. type inference fails
        Completion[]
    end
    filter!(is_target_completion, cs)

    return completion.(cs)
end

function repl_resolvecompletion_request(conn, completion_item, token)
    return completion_item # not used currently, return as is
end

function is_target_completion(c)
    return c isa PropertyCompletion ||
        c isa FieldCompletion ||
        c isa DictCompletion
end

completion(c) = (
    label = completion_label(c),
    detail = string("REPL completion. ", completion_detail(c)),
    kind = completion_kind(c)
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
