"""
    InlineDisplay

Internal display for plots, html elements, and custom panes in VS Code. Supports various
standard MIME-types out of the box, but also two VS Code specific ones:

- `application/vnd.julia-vscode.plotpane+html`: For outputting HTML into the plotpane.
- `application/vnd.julia-vscode.custompane+html`: For outputting HTML into custom panes,
specified by the `id` parameter (see below)

All MIME-types passed into the `display` call may specify parameters following RFC 9110
Section 5.6.6. Parameters use the form `;param=value` or `;param="quoted value"`.
Supported parameters:

- `id`: Identifies the object being shown. In the plotpane, an object with the same id as a
  previously shown one will overwrite the older one. For the `custompane` MIME-type, this id
  uniquely identifies the pane.
- `title`: (Optional) Sets a custom title for the pane. For `custompane`, if not provided,
  the id is used as the title.

Parameter names are case-insensitive and must be ASCII tokens (alphanumeric and `! # \$ % & ' * + - . ^ _ \` | ~`).
Parameter values may be unquoted tokens (same ASCII character set as names) or quoted strings.
Quoted strings support full UTF-8 encoding and can contain any characters including semicolons.
Within quoted strings, use `\\"` to escape a double quote and `\\\\` to escape a backslash.

Example: `MIME("application/vnd.julia-vscode.custompane+html;id=my-pane;title=\\"Résumé; Final\\"")`
"""
struct InlineDisplay <: AbstractDisplay
    is_repl::Bool
end

InlineDisplay() = InlineDisplay(false)

const PLOT_PANE_ENABLED = Ref(true)
const DIAGNOSTICS_ENABLED = Ref(true)
const INLAY_HINTS_ENABLED = Ref(true)
const PROGRESS_ENABLED = Ref(true)

function toggle_plot_pane_notification(_, params::NamedTuple{(:enable,),Tuple{Bool}})
    PLOT_PANE_ENABLED[] = params.enable
end

function toggle_diagnostics_notification(_, params::NamedTuple{(:enable,),Tuple{Bool}})
    DIAGNOSTICS_ENABLED[] = params.enable
end

function toggle_inlay_hints_notification(_, params::NamedTuple{(:enable,),Tuple{Bool}})
    INLAY_HINTS_ENABLED[] = params.enable
end

function toggle_progress_notification(_, params::NamedTuple{(:enable,),Tuple{Bool}})
    PROGRESS_ENABLED[] = params.enable
end

function fix_displays(; is_repl=false)
    for d in reverse(Base.Multimedia.displays)
        if d isa InlineDisplay
            popdisplay(d)
        end
    end
    pushdisplay(InlineDisplay(is_repl))
end

function with_no_default_display(f; allow_inline=false)
    stack = copy(Base.Multimedia.displays)
    filter!(Base.Multimedia.displays) do d
        !(d isa REPL.REPLDisplay || d isa TextDisplay || (!allow_inline && d isa InlineDisplay))
    end
    try
        return f()
    finally
        empty!(Base.Multimedia.displays)
        foreach(pushdisplay, stack)
    end
end


function sendDisplayMsg(kind, data, id=missing, title=missing)
    msg = Dict{String,Any}("kind" => kind, "data" => data, "id" => id, "title" => title)
    return try
        JSONRPC.send_notification(conn_endpoint[], "display", msg)
        JSONRPC.flush(conn_endpoint[])
    catch
        maybe_queue_notification!("display", msg) || rethrow()
    end
end

function parse_mime_parameters(params_str::AbstractString)
    # Parse parameters according to RFC 9110 Section 5.6.6
    # parameters = *( OWS ";" OWS [ parameter ] )
    # parameter = token "=" ( token / quoted-string )
    # token = 1*tchar where tchar excludes delimiters
    # quoted-string = DQUOTE *( qdtext / quoted-pair ) DQUOTE

    params = Dict{String,String}()
    pos = 1

    # tchar = "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+" / "-" / "." /
    #         "^" / "_" / "`" / "|" / "~" / DIGIT / ALPHA
    token_re = r"[!#$%&'*+\-.0-9A-Z^-z|~]+"

    function get_context(pos, width=20)
        last_idx = lastindex(params_str)
        # Clamp pos to valid range before using prevind/nextind
        pos = clamp(pos, 1, last_idx)

        start_pos = max(1, prevind(params_str, pos, width))
        end_pos = min(last_idx, nextind(params_str, pos, width))

        context = params_str[start_pos:end_pos]
        caret_pos = textwidth(params_str[start_pos:prevind(params_str, pos)]) + 1
        caret_line = " "^(caret_pos - 1) * "^"
        return context * "\n" * caret_line
    end

    function parsing_error(message, pos)
        error("Invalid MIME parameter: $message at position $pos\n\n$(get_context(pos))")
    end

    while pos <= ncodeunits(params_str)
        # Expect semicolon at this point (we've either just started or completed a previous parameter)
        if params_str[pos] != ';'
            parsing_error("expected ';'", pos)
        end
        pos = nextind(params_str, pos)  # skip semicolon

        # Skip OWS after semicolon
        ows = findnext(r"[ \t]*", params_str, pos)
        if ows !== nothing
            pos = nextind(params_str, ows.stop)
        end

        if pos > ncodeunits(params_str)
            # Empty parameter after semicolon - valid per spec (optional parameter)
            break
        end

        # Parse parameter name (token)
        name_match = findnext(token_re, params_str, pos)
        if name_match === nothing || name_match.start != pos
            parsing_error("expected token (parameter name)", pos)
        end
        param_name = lowercase(params_str[name_match])  # parameter names are case-insensitive
        pos = nextind(params_str, name_match.stop)

        # Expect '=' with no whitespace around it (per spec)
        if pos > ncodeunits(params_str)
            parsing_error("expected '=' after parameter name '$param_name'", pos)
        end
        if params_str[pos] != '='
            c = params_str[pos]
            # Check if this is a non-ASCII character that's not allowed in parameter names
            if !isascii(c)
                parsing_error("character '$c' is not allowed in parameter names (only ASCII alphanumerics and !#\$%&'*+-.^_`|~ are allowed)", pos)
            else
                parsing_error("expected '=' after parameter name '$param_name', got '$c'", pos)
            end
        end
        pos = nextind(params_str, pos)  # skip '='

        if pos > ncodeunits(params_str)
            parsing_error("expected value after '$param_name='", pos)
        end

        # Parse parameter value (token or quoted-string)
        if params_str[pos] == '"'
            # quoted-string = DQUOTE *( qdtext / quoted-pair ) DQUOTE
            # qdtext = HTAB / SP / %x21 / %x23-5B / %x5D-7E / obs-text
            # quoted-pair = "\" ( HTAB / SP / VCHAR / obs-text )
            quote_start = pos
            pos = nextind(params_str, pos)  # skip opening DQUOTE
            value_chars = Char[]
            found_closing_quote = false

            while pos <= ncodeunits(params_str)
                c = params_str[pos]
                if c == '\\'
                    # quoted-pair: backslash followed by HTAB / SP / VCHAR / obs-text
                    pos = nextind(params_str, pos)
                    if pos <= ncodeunits(params_str)
                        push!(value_chars, params_str[pos])
                        pos = nextind(params_str, pos)
                    else
                        parsing_error("unterminated escape sequence in quoted string for '$param_name'", pos)
                    end
                elseif c == '"'
                    # End of quoted-string
                    found_closing_quote = true
                    pos = nextind(params_str, pos)
                    break
                else
                    # qdtext character
                    push!(value_chars, c)
                    pos = nextind(params_str, pos)
                end
            end

            # Check if we found a closing quote
            if !found_closing_quote
                parsing_error("unterminated quoted string for '$param_name' starting", quote_start)
            end

            param_value = String(value_chars)
        else
            # token value
            value_match = findnext(token_re, params_str, pos)
            if value_match === nothing || value_match.start != pos
                parsing_error("expected token or quoted-string value for '$param_name'", pos)
            end
            param_value = params_str[value_match]
            pos = nextind(params_str, value_match.stop)
        end

        params[param_name] = param_value

        # After a parameter, we expect OWS followed by either ';' or end of string
        # Skip OWS (optional whitespace)
        ows = findnext(r"[ \t]*", params_str, pos)
        if ows !== nothing
            pos = nextind(params_str, ows.stop)
        end

        # Now we should be at either end of string or semicolon
        if pos > ncodeunits(params_str)
            # End of string - we're done
            break
        elseif params_str[pos] != ';'
            # Unexpected character after parameter
            c = params_str[pos]
            # Check if this is a non-ASCII character that's not allowed in tokens
            if !isascii(c)
                parsing_error("character '$c' is not allowed in unquoted token values (use quotes: $param_name=\"$param_value$c...\")", pos)
            else
                parsing_error("expected ';' or end of parameters after '$param_name=$param_value', got '$c'", pos)
            end
        end
        # If we get here, we're at a semicolon and the while loop will continue
    end

    return params
end

function extract_mime_id(m::MIME)
    mime = string(m)

    # Find first semicolon to separate mime type from parameters
    semicolon_idx = findfirst(";", mime)
    if semicolon_idx === nothing
        return mime, missing, missing
    end
    semicolon_idx = first(semicolon_idx)

    mime_type = mime[1:(semicolon_idx-1)]
    params_str = mime[semicolon_idx:end]

    params = parse_mime_parameters(params_str)

    id = get(params, "id", missing)
    title = get(params, "title", missing)

    return mime_type, id, title
end

function Base.display(d::InlineDisplay, m::MIME, @nospecialize(x))
    if !PLOT_PANE_ENABLED[]
        with_no_default_display(() -> display(m, x))
    else
        mime, id, title = extract_mime_id(m)
        m = MIME(mime)
        if mime in DISPLAYABLE_MIMES
            # non-`image/...` mime types are not binary
            payload = startswith(mime, "image") ? stringmime(m, x) : String(repr(m, x))
            sendDisplayMsg(mime, payload, id, title)
        else
            throw(MethodError(display, (d, m, x)))
        end
    end
    return nothing
end

Base.Multimedia.istextmime(::MIME{Symbol("juliavscode/html")}) = true
Base.Multimedia.istextmime(::MIME{Symbol("application/vnd.julia-vscode.plotpane+html")}) = true
Base.Multimedia.istextmime(::MIME{Symbol("application/vnd.julia-vscode.custompane+html")}) = true

Base.Multimedia.displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.dataresource+json")}) = true

function Base.display(::InlineDisplay, m::MIME{Symbol("application/vnd.dataresource+json")}, x)
    payload = String(repr(m, x))
    sendDisplayMsg(string(m), payload)
end

Base.Multimedia.displayable(d::InlineDisplay, ::MIME{Symbol("application/vnd.plotly.v1+json")}) = true

function Base.Multimedia.displayable(_::InlineDisplay, mime::MIME)
    if PLOT_PANE_ENABLED[]
        m, _, _ = extract_mime_id(mime)
        return m in DISPLAYABLE_MIMES
    end
    return false
end

const DISPLAYABLE_MIMES = [
    "application/vnd.vegalite.v5+json",
    "application/vnd.vegalite.v4+json",
    "application/vnd.vegalite.v3+json",
    "application/vnd.vegalite.v2+json",
    "application/vnd.vega.v5+json",
    "application/vnd.vega.v4+json",
    "application/vnd.vega.v3+json",
    "application/vnd.plotly.v1+json",
    "application/vnd.julia-vscode.plotpane+html", # displays html
    "application/vnd.julia-vscode.custompane+html", # displays html in custom pane (metadata via parameter)
    "juliavscode/html", # deprecated
    # "text/html",
    "image/png",
    "image/svg+xml",
    "image/gif",
]

"""
    DIAGNOSTIC_MIME = "application/vnd.julia-vscode.diagnostics"

User type needs to implement a `show` method that returns a named tuple or dictionary like the following
```
Base.show(io::IO, ::MIME"application/vnd.julia-vscode.diagnostics", t::YourType) = (
    source = "Name of my diagnostic tool"
    items = [
        (
            msg = "foo",
            path = "/some/absolute/path.jl",
            line = 1 # 1 based
            range = [[1, 2], [1, 4]] # or [[start_line, start_char], [end_line, end_char]],
            severity = 1, # optional; 0: Error, 1: Warning, 2: Information, 3: Hint
            relatedInformation = [
                (
                    msg = "foobar",
                    path = "/some/other/absolute/path.jl",
                    line = 1,
                    range = [[1, 2], [1, 4]] # or [[start_line, start_char], [end_line, end_char]],
                )
            ] # optional
        ),
        ...
    ]
)
```
One of `line` or `range` needs to be specified for each item and `relatedInformation`.

Anything printed to `io` is discarded.
"""
const DIAGNOSTIC_MIME = "application/vnd.julia-vscode.diagnostics"
Base.Multimedia.displayable(::InlineDisplay, ::MIME{Symbol(DIAGNOSTIC_MIME)}) = DIAGNOSTICS_ENABLED[]
function Base.Multimedia.display(d::InlineDisplay, m::MIME{Symbol(DIAGNOSTIC_MIME)}, diagnostics)
    sendDisplayMsg(DIAGNOSTIC_MIME, show(IOBuffer(), m, diagnostics))
    if d.is_repl
        display(MIME"text/plain"(), diagnostics)
    end
end

"""
    INLAY_HINTS_MIME = "application/vnd.julia-vscode.inlayHints"

User type needs to implement a `show` method that returns a dictionary like the following

```
Base.show(io::IO, ::MIME"application/vnd.julia-vscode.inlayHints", t::YourType) = Dict("/some/other/absolute/path.jl" => [(
    position = (4, 1), # line, column (0 indexed)
    label = "::R",
    kind = 1, # optional; 1: Type, 2: Parameter, nothing: undefined
    tooltip = "test", # optional
    paddingLeft = false, # optional
    paddingRight = false # optional
)])
```

Anything printed to `io` is discarded.
"""
const INLAY_HINTS_MIME = "application/vnd.julia-vscode.inlayHints"
Base.Multimedia.displayable(::InlineDisplay, ::MIME{Symbol(INLAY_HINTS_MIME)}) = INLAY_HINTS_ENABLED[]
function Base.Multimedia.display(d::InlineDisplay, m::MIME{Symbol(INLAY_HINTS_MIME)}, inlay_hints)
    sendDisplayMsg(INLAY_HINTS_MIME, show(IOBuffer(), m, inlay_hints))
    if d.is_repl
        display(MIME"text/plain"(), inlay_hints)
    end
end

function is_table_like(x)
    if showable("application/vnd.dataresource+json", x)
        return true
    end

    istable = Base.invokelatest(_isiterabletable, x)

    if istable === missing || istable === true || x isa AbstractVector || x isa AbstractMatrix
        return true
    end

    return false
end

function can_display(x)
    for mime in DISPLAYABLE_MIMES
        if showable(mime, x)
            return true
        end
    end

    return is_table_like(x)
end

function Base.display(d::InlineDisplay, @nospecialize(x))
    if DIAGNOSTICS_ENABLED[] && showable(DIAGNOSTIC_MIME, x)
        return display(d, DIAGNOSTIC_MIME, x)
    end
    if INLAY_HINTS_ENABLED[] && showable(INLAY_HINTS_MIME, x)
        return display(d, INLAY_HINTS_MIME, x)
    end
    if PLOT_PANE_ENABLED[]
        for mime in DISPLAYABLE_MIMES
            if showable(mime, x)
                return display(d, mime, x)
            end
        end
    else
        return with_no_default_display(() -> display(x))
    end

    throw(MethodError(display, (d, x)))
end

function _display(d::InlineDisplay, x)
    if showable("application/vnd.dataresource+json", x)
        display(d, "application/vnd.dataresource+json", x)
    else
        try
            display(d, x)
        catch err
            if err isa MethodError && err.f === display
                @warn "Cannot display values of type $(typeof(x)) in VS Code."
            else
                rethrow(err)
            end
        end
    end
end

function repl_showingrid_notification(conn, params::NamedTuple{(:code,),Tuple{String}})
    try
        var = Base.invokelatest(Base.include_string, Main, params.code)

        Base.invokelatest(internal_vscodedisplay, var, params.code)
    catch err
        Base.display_error(err, catch_backtrace())
    end
end

function internal_vscodedisplay(x, title::AbstractString="")
    if is_table_like(x)
        showtable(x, title)
    else
        _display(InlineDisplay(), x)
    end
end

vscodedisplay(x, title::AbstractString="") = internal_vscodedisplay(x, title)
vscodedisplay(title::AbstractString) = i -> vscodedisplay(i, title)
macro vscodedisplay(x)
    :(vscodedisplay($(esc(x)), $(string(x))))
end
