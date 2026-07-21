# completions
# -----------

using REPL.REPLCompletions
using REPL.REPLCompletions: Completion, KeywordCompletion, PathCompletion, ModuleCompletion,
    PackageCompletion, PropertyCompletion, FieldCompletion, MethodCompletion, BslashCompletion,
    ShellCompletion, DictCompletion

function repl_getcompletions_request(_, params::GetCompletionsRequestParams, @nospecialize(token))
    mod, line = params.mod, params.line
    mod = module_from_string(mod)

    cs, replace_range = try
        ret = Base.invokelatest(completions, line, lastindex(line), mod)
        ret[1], ret[2]
    catch err
        @debug "completion error" exception=(err, catch_backtrace())
        # might error when e.g. type inference fails
        Completion[], 1:0
    end
    filter!(is_target_completion, cs)

    # UTF-16 length of the typed text the completions replace (it always ends at
    # the cursor); lets the client build an exact replacement range instead of
    # relying on the editor's word-based guess, which breaks for e.g. `x.var"he`
    # (julia-vscode#3867)
    prefix_length = isempty(replace_range) ? 0 : utf16_length(line[replace_range])

    return completion.(cs, prefix_length)
end

utf16_length(s::AbstractString) = isempty(s) ? 0 : sum(c -> UInt32(c) > 0xFFFF ? 2 : 1, s)

function repl_resolvecompletion_request(conn, completion_item, @nospecialize(token))
    return completion_item # not used currently, return as is
end

function is_target_completion(c)
    return c isa PropertyCompletion ||
        c isa FieldCompletion ||
        c isa DictCompletion
end

completion(c, prefix_length) = (
    label = completion_label(c),
    detail = string("REPL completion. ", completion_detail(c)),
    kind = completion_kind(c),
    prefixLength = prefix_length
)

completion_label(c) = completion_text(c)
completion_label(c::DictCompletion) = rstrip(completion_text(c), (']', '"'))

completion_detail(c::PropertyCompletion) = begin
    _hasproperty(c.value, c.property) || return ""
    isdefined(c.value, c.property) || return "#undef"
    t = typeof(getproperty(c.value, c.property))
    string(t)
end
completion_detail(c::FieldCompletion) = string(fieldtype(c.typ, c.field))
completion_detail(c::DictCompletion) = string(valtype(c.dict))
completion_detail(c) = ""

# always mark these completions as Events to distinguish them from LS completions
completion_kind(c) = 22
