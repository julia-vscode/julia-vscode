using Base.Docs, Markdown
using Markdown: MD, HorizontalRule


function get_doc_html(params)
    docs = getdocs(params["module"], params["word"])
    return to_webview_html.(docs.content) |> join
end

const CODE_LANG_REGEX = r"\<code class\=\"language-(?<lang>(?!\>).+)\"\>"

to_webview_html(x) = html(x)
function to_webview_html(md::MD)
    # HACK goes on ...
    s = html(md)
    if haskey(md.meta, :module)
        mod = md.meta[:module]
        newhref = string("julia-vscode", '/', mod)
        s = replace(s, "<a href=\"@ref\"" => "<a href=\"$newhref\"")
    end
    s = replace(s, CODE_LANG_REGEX => annotate_highlight_js)
    return s
end

function annotate_highlight_js(s)
    m::RegexMatch = match(CODE_LANG_REGEX, s)
    lang = m[:lang]
    if lang == "jldoctest"
        lang = "julia-repl"
    end
    return "<code class=\"language-$(lang) hljs\">"
end

"""
    getdocs(mod::Module, word::AbstractString, fallbackmod::Module = Main)
    getdocs(mod::AbstractString, word::AbstractString, fallbackmod::Module = Main)

Retrieves docs for `mod.word` with [`@doc`](@ref) macro. If `@doc` is not available
  within `mod` module, `@doc` will be evaluated in `fallbackmod` module if possible.

!!! note
    You may want to run [`cangetdocs`](@ref) in advance.
"""
function getdocs(mod::Module, word::AbstractString, fallbackmod::Module = Main)
    return try
        if iskeyword(word)
            Core.eval(Main, :(@doc($(Symbol(word)))))
        else
            docsym = Symbol("@doc")
            if isdefined(mod, docsym)
                include_string(mod, "@doc $word")
            elseif isdefined(fallbackmod, docsym)
                word = string(mod) * "." * word
                include_string(fallbackmod, "@doc $word")
            else
                MD("@doc is not available in " * string(mod))
            end
        end
    catch err
        MD("")
    end |> add_hlines!
end
getdocs(mod::AbstractString, word::AbstractString, fallbackmod::Module = Main) =
    getdocs(module_from_string(mod), word, fallbackmod)

function add_hlines!(md)
    if !isa(md, MD) || !haskey(md.meta, :results) || isempty(md.meta[:results])
        return md
    end
    return MD(interpose(md.content, HorizontalRule()))
end

"""
    cangetdocs(mod::Module, word::Symbol)
    cangetdocs(mod::Module, word::AbstractString)
    cangetdocs(mod::AbstractString, word::Union{Symbol, AbstractString})

Checks if the documentation bindings for `mod.word` is resolved and `mod.word`
  is not deprecated.
"""
cangetdocs(mod::Module, word::Symbol) =
    Base.isbindingresolved(mod, word) && !Base.isdeprecated(mod, word)
cangetdocs(mod::Module, word::AbstractString) = cangetdocs(mod, Symbol(word))
cangetdocs(mod::AbstractString, word::Union{Symbol,AbstractString}) =
    cangetdocs(module_from_string(mod), word)
