# completions
# -----------

using REPL.REPLCompletions
using REPL.REPLCompletions: Completion, KeywordCompletion, PathCompletion, ModuleCompletion,
    PackageCompletion, PropertyCompletion, FieldCompletion, MethodCompletion, BslashCompletion,
    ShellCompletion, DictCompletion

function repl_getcompletions_request(_, params::GetCompletionsRequestParams)
    mod, line = params.mod, params.line
    mod = module_from_string(mod)

    cs = try
        first(completions(line, lastindex(line), mod))
    catch err
        # might error when e.g. type inference fails
        Completion[]
    end
    filter!(is_target_completion, cs)

    return completion.(cs)
end

repl_resolvecompletion_request(conn, completion_item) = completion_item # not used currently, return as is

function is_target_completion(c)
    return c isa PropertyCompletion ||
        c isa FieldCompletion ||
        c isa DictCompletion
end

completion(c) = (
    label = completion_label(c),
    detail = completion_detail(c),
    kind = completion_kind(c),
)

completion_label(c) = completion_text(c)
completion_label(c::DictCompletion) = rstrip(completion_text(c), (']', '"'))

completion_detail(c::PropertyCompletion) = begin
    isdefined(c.value, c.property) || return ""
    t = typeof(getproperty(c.value, c.property))
    string(t)
end
completion_detail(c::FieldCompletion) = string(fieldtype(c.typ, c.field))
completion_detail(c::DictCompletion) = string(valtype(c.dict))

completion_kind(::PropertyCompletion) = 9
completion_kind(::FieldCompletion) = 4
completion_kind(::DictCompletion) = 19


# signature help
# --------------

using .JuliaInterpreter: sparam_syms
using Base.Docs, Markdown

function repl_getsignaturehelp_request(_, params::GetSignatureHelpRequestParams)
    sig, mod, context = params.sig, params.mod, params.context

    mod = module_from_string(mod)

    if context["isRetrigger"] && !haskey(context, "triggerCharacter") && !endswith(rstrip(sig), ',')
        sig = string(sig, ',') # force method completion invocation for retriggered case (to narrow down candidates)
    end
    mcs::Vector{MethodCompletion} = try
        cs = first(completions(sig, lastindex(sig), mod))
        filter!(is_method_completion, cs)
    catch err
        MethodCompletion[] # might error when e.g. type inference fails
    end

    isempty(mcs) && return nothing

    return SignatureHelp(
        active_parameter(mcs),
        active_signature(mcs, context),
        signature_information.(mcs)
    )
end

const is_method_completion = Base.Fix2(isa, MethodCompletion)

active_parameter(mcs::Vector{MethodCompletion}) = isempty(mcs) ? 0 : active_parameter(first(mcs))
active_parameter(mc::MethodCompletion) = length(mc.input_types.types)

function active_signature(mcs, context)
    (active = get(context, "activeSignatureHelp", nothing)) === nothing && return 0
    length(mcs) === length(active["signatures"]) && return active["activeSignature"] # respect previous selection if signature candidates haven't changed
    return 0 # fallback
end

# TODO: FIFO cache refreshing
# set a threshold up to which SIGNATURE_CACHE can get fat, to make sure it won't eat up memory, e.g.
# `const MAX_SIGNATURE_INFO_CACHE_SIZE = 3000`

const SIGNATURE_INFO_CACHE = Dict{UInt64,SignatureInformation}()

function signature_information(mc::MethodCompletion)
    h = hash(mc)
    (v = get(SIGNATURE_INFO_CACHE, h, nothing)) !== nothing && return v

    f, tt, m = mc.func, mc.input_types, mc.method

    # return type inference
    rt = rt_inf(f, m, Base.tuple_type_tail(tt))

    return SIGNATURE_INFO_CACHE[h] = SignatureInformation(
        active_parameter(mc),
        signature_documentation(m),
        signature_label(m, rt),
        signature_parameters(tt, m)
    )
end

function rt_inf(@nospecialize(f), m, @nospecialize(tt::Type))
    try
        world = typemax(UInt) # world age

        # first infer return type using input types
        # NOTE:
        # since input types are all concrete, the inference result from them is the best what we can get
        # so here we eagerly respect it if inference succeeded
        if !isempty(tt.parameters)
            inf = Core.Compiler.return_type(f, tt, world)
            inf ∉ (nothing, Any, Union{}) && return inf
        end

        # sometimes method signature can tell the return type by itself
        sparams = Core.svec(sparam_syms(m)...)
        inf = @static if isdefined(Core.Compiler, :NativeInterpreter)
            Core.Compiler.typeinf_type(Core.Compiler.NativeInterpreter(), m, m.sig, sparams)
        else
            Core.Compiler.typeinf_type(m, m.sig, sparams, Core.Compiler.Params(world))
        end
        inf ∉ (nothing, Any, Union{}) && return inf
    catch err
        # @error err
    end
    return nothing
end

signature_label(m, ::Nothing) = method_label(m) # inference failed
signature_label(m, @nospecialize(rt)) = string(method_label(m), " -> ", rt)

function method_label(m)
    s = string(m)
    m = match(r"^(.*) in .*$", s)
    return m isa Nothing ? s : m[1]
end

function signature_documentation(m)
    mod = m.module
    fsym = m.name
    return if cangetdocs(mod, fsym)
        try
            docs = Docs.doc(Docs.Binding(mod, fsym), Base.tuple_type_tail(m.sig))
            s = string(docs)
            # maybe we want to add some more hacks to use vscode command uri here
            occursin("No documentation found.", s) ? "" : MarkdownString(value = s)
        catch err
            # @error err
            ""
        end
    else
        ""
    end
end

function signature_parameters(@nospecialize(tt::Type), m)
    # method signature hacks
    _, decls, _ = Base.arg_decl_parts(m)

    return map(collect(zip(tt.types, decls))[2:end]) do (t, (argname, argtype))
        ParameterInformation(parameter_label(argname, argtype), string(t))
    end
end

parameter_label(argname, argtype) = isempty(argtype) ? argname : string(argname, "::", argtype)

"""
    cangetdocs(mod::Module, word::Symbol)
    cangetdocs(mod::Module, word::AbstractString)
    cangetdocs(mod::AbstractString, word::Union{Symbol, AbstractString})

Checks if the documentation bindings for `mod.word` is resolved and `mod.word`
  is not deprecated.
"""
cangetdocs(mod::Module, word::Symbol) = Base.isbindingresolved(mod, word) && !Base.isdeprecated(mod, word)
cangetdocs(mod::Module, word::AbstractString) = cangetdocs(mod, Symbol(word))
cangetdocs(mod::AbstractString, word::Union{Symbol, AbstractString}) = cangetdocs(module_from_string(mod), word)
