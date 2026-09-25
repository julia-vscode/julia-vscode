# Replacing vendored JSON 0.20 with upstream `vendor/jsonx.jl`

**Status:** design only — not scheduled, nothing implemented.
**Date:** 2026-09-10

This is a handoff document. It records the investigation and a complete design for replacing
the vendored JSON.jl v0.20.1 submodule with upstream JSON.jl's `vendor/jsonx.jl`, while keeping
JSONRPC's ability to run on real JSON 1 where that is available. Findings marked *verified* were
checked against the actual code or by running Julia locally; everything else is design intent.

---

## 1. Why this came up

`scripts/packages/JSON` is a git submodule pinned to JSON.jl **v0.20.1**, and two more
byte-identical copies live inside other submodules:

- `scripts/packages/JuliaWorkspaces/packages/JSON`
- `scripts/packages/TestItemControllers/packages/JSON`

(All three verified byte-identical; `src/Writer.jl` checksums to `eab8f700ab184084649959c0c51cbbd469e50318`
in each.)

The pin exists for exactly one reason, stated in the repo itself:

- `scripts/packages/TestItemControllers/scripts/update_vendored_packages.jl:15` —
  `# "JSON" => "", We skip this as we want to stay on an old version that has one less extra dependency`
- `scripts/packages/JSONRPC/.github/workflows/juliaci-oldjson.yml` — *"the last JSON version
  without non-stdlib dependencies"*

That matters because five modules load JSON by **textually `include`-ing its source** into a
private namespace, so they need no Pkg dependency and no manifest resolution at all:

| include site | runs on |
|---|---|
| `scripts/packages/VSCodeServer/src/VSCodeServer.jl:13` | Julia 1.0–1.13 |
| `scripts/packages/VSCodeDebugger/src/VSCodeDebugger.jl:8` | Julia 1.0–1.13 |
| `scripts/packages/TestItemControllers/src/TestItemControllers.jl:7` | Julia 1.12+ |
| `scripts/packages/TestItemControllers/testprocess/TestItemServer/src/pkg_imports.jl:3` | Julia 1.0+ |
| `scripts/packages/JuliaWorkspaces/juliadynamicanalysisprocess/JuliaDynamicAnalysisProcess/src/pkg_imports.jl:1` | Julia 1.0+ |

Each then wires sub-modules up with `import ..JSON`, e.g. in `VSCodeServer.jl`:

```julia
module JSONRPC
import ..CancellationTokens
import ..JSON
import UUIDs, Sockets
include("../../JSONRPC/src/packagedef.jl")
end
```

Upstream JSON.jl master now ships `vendor/jsonx.jl` — a **365-line, zero-dependency `module JSONX`**
explicitly meant to be copy-pasted into other packages. It is a strictly better answer to the
"no non-stdlib deps" constraint than freezing a 2019 release forever: one file instead of a
submodule, maintained alongside JSON.jl master, and it deletes all three vendored copies.

### Why it is not a drop-in

JSONX's entire public surface is `parse`, `parsefile`, `json`, `JSONText`. It has:

- **no `lower` hook** — its writer is `write_json(io, value)`, a plain `if/elseif value isa …`
  chain on `Any`, *not* dispatch. There is no extension point at all; user structs hit
  `throw(ArgumentError("Cannot serialize $(typeof(value)) to JSON"))`.
- **no `print(io, x)`**, no streaming writer context, no serialization styles, no pretty
  printing, no `Dates` support, no `dicttype` keyword.
- **no `export` statements** — `names(JSONX) == [:JSONX]` (verified).

Against that, the repo currently uses:

- `JSON.lower` overloads in LanguageServer (×2), JSONRPC, DAPRPC, TestItemControllers
- `JSON.Writer.CompositeTypeWrapper` in DAPRPC — a type the vendored `Writer.jl` docstring
  explicitly marks *"Internal JSON.jl implementation detail; do not depend on this type."*
- ~30 calls into the 0.20 streaming `Writer` API in `tableviewer.jl`
- `JSON.print(io, struct)` in TestItemControllers, relying on 0.20's reflective fallback

### The idea that makes it work

**If JSONRPC lowers every outbound value to plain JSON-native types itself, the backend API
shrinks to `parse` + `json` — which JSONX *and* JSON 1 provide identically.**

The compat shim then *shrinks* instead of growing a third branch, and JSON 1 support is
preserved rather than lost. That is the spine of the whole design.

### Decisions taken during design review

1. **`JSONRPC.lower` replaces the `serialization`/style parameter** on `JSONRPCEndpoint`.
   Breaking → JSONRPC **4.0**. Verified safe: every production construction in the repo is
   two-argument; the only three-argument call sites are
   `scripts/packages/JSONRPC/test/test_json_serialization.jl:27,47`.
2. **JSON 0.20/0.21 compat is dropped.** Supported backends become JSONX (vendored) and JSON 1.
3. Whether real JSON 1 also ships *inside* the extension was left **open** — see §7.

---

## 2. Hard blocker: JSONX does not run on Julia 1.0–1.5 (verified)

`jsonx.jl`'s `parse_number` does `num_str = @view str[start_pos:pos-1]`, and
`view(::String, ::UnitRange)` does not exist before Julia 1.6:

```
julia 1.0: view FAILS -> MethodError
julia 1.5: view FAILS -> MethodError
julia 1.6: view OK    -> SubString{String}
```

`VSCodeServer`/`VSCodeDebugger` declare `julia = "1"` and `.github/workflows/main.yml:231` runs
them on `['1.0','1.1',…,'1.9','1.11','1.12']`. `TestItemServer`'s and
`JuliaDynamicAnalysisProcess`'s `pkg_imports.jl` both carry `scripts/packages-old/v1.5/…`
branches, so they target 1.0 too.

The vendored copy therefore needs **one** local delta:

```diff
-    num_str = @view str[start_pos:pos-1]
+    num_str = SubString(str, start_pos, pos - 1)
```

Semantically identical on modern Julia — `parse_number` only advances over ASCII bytes, so
`start_pos` and `pos-1` are always valid character boundaries and `pos-1 >= start_pos` always holds.

**This should go upstream first.** `vendor/jsonx.jl` advertises itself as copy-paste-anywhere, and
`SubString` is a strictly more portable spelling with no downside. If upstream takes it, the
vendored copy stays byte-identical to upstream forever, which is the whole point of the exercise.

Everything else in the file was checked and is fine on 1.0: `GC.@preserve` +
`unsafe_string(pointer(str,i),n)`, `ncodeunits`, `codeunit`, `nextind`, `pairs(::NamedTuple)`,
`value isa Enum`, `string(Int(c), base=16, pad=4)`, the surrogate-pair arithmetic, and the
module-local `unescape_string` shadowing the Base export.

---

## 3. Backend-agnostic JSONRPC core

### 3.1 New `scripts/packages/JSONRPC/src/lower.jl`

Included from `packagedef.jl` between `jsoncompat.jl` and `core.jl`:

```julia
"""
    JSONRPC.lower(x)

Translate `x` into something JSONRPC knows how to put on the wire. The default is the
identity; define a method for your own types. The return value need not be *recursively*
plain — `_to_plain` walks whatever comes back.
"""
lower(x) = x

_to_plain(x::Nothing)        = nothing
_to_plain(x::Missing)        = nothing            # 0.20 parity: null inside containers
_to_plain(x::Bool)           = x
_to_plain(x::Integer)        = x
_to_plain(x::AbstractFloat)  = isfinite(x) ? x : nothing   # 0.20 parity: NaN/Inf -> null
_to_plain(x::Real)           = _to_plain(float(x))         # Rational, FixedPoint, …
_to_plain(x::AbstractString) = x
_to_plain(x::Symbol)         = String(x)
_to_plain(x::Char)           = string(x)
_to_plain(x::Enum)           = string(x)
_to_plain(x::Type)           = string(x)
_to_plain(x::JSONText)       = x                  # raw splice — never touched

_to_plain(x::AbstractDict) = Dict{String,Any}(_to_plain_key(k) => _to_plain(v) for (k, v) in x)
_to_plain(x::NamedTuple)   = Dict{String,Any}(String(k) => _to_plain(v) for (k, v) in pairs(x))
_to_plain(x::Union{AbstractVector,Tuple,AbstractSet}) = Any[_to_plain(v) for v in x]

# 0.20 serialized N-d arrays column-major as nested arrays; keep that.
function _to_plain(A::AbstractArray{<:Any,N}) where {N}
    N == 1 && return Any[_to_plain(v) for v in A]
    rest = ntuple(_ -> Colon(), N - 1)
    return Any[_to_plain(view(A, rest..., j)) for j in axes(A, N)]
end

_to_plain_key(k) = string(_to_plain(k))

_to_plain(@nospecialize(x)) = _to_plain_lowered(lower(x), x)

function _to_plain_lowered(@nospecialize(lowered), @nospecialize(original))
    lowered === original && throw(ArgumentError(
        "JSONRPC cannot serialize a value of type $(typeof(original)); " *
        "define `JSONRPC.lower` for it"))
    return _to_plain(lowered)
end
```

`interface_def.jl:3` changes from `function JSON.lower(a::Outbound)` to `function lower(a::Outbound)`;
body unchanged. (`Outbound` is declared in `interface_def.jl`, included *after* `lower.jl`, so
`lower` is already a generic function by then.)

### 3.2 Why each line is load-bearing — differential results vs vendored 0.20

`**` marks a difference from today's wire format:

```
   1                    0.20=1                    JSONX=1
   1.0e20               0.20=1.0e20               JSONX=1.0e20
   -0.0                 0.20=-0.0                 JSONX=-0.0
** NaN                  0.20=null                 JSONX=NaN          <- INVALID JSON
** Inf                  0.20=null                 JSONX=Inf          <- INVALID JSON
** -Inf                 0.20=null                 JSONX=-Inf         <- INVALID JSON
** 1//3                 0.20=0.3333333333333333   JSONX=1//3         <- INVALID JSON
   Float32(1e20)        0.20=1.0e20               JSONX=1.0e20
   Int128(2)^100        0.20=1267650600228229…    JSONX=1267650600228229…
   big"1.5"             0.20=1.5                  JSONX=1.5
   "a/b"                0.20="a/b"                JSONX="a/b"        (neither escapes solidus)
   "héllo" / "😀"        identical                 identical          (neither \u-escapes non-ASCII)
** "\x7f" (DEL)         0.20="\u007f"             JSONX=<raw DEL>    <- both valid, bytes differ
   "\x1f"               0.20="\u001f"             JSONX="\u001f"
   missing / nothing    0.20=null                 JSONX=null
   :sym                 0.20="sym"                JSONX="sym"
** 'c' (Char)           0.20="c"                  JSONX=ArgumentError
** Date(2020,1,2)       0.20="2020-01-02"         JSONX=ArgumentError
** DateTime / Time      0.20=ISO string           JSONX=ArgumentError
** Int32 (a Type)       0.20="Int32"              JSONX=ArgumentError
** [1 2; 3 4]           0.20=[[1,3],[2,4]]        JSONX=ArgumentError
** 1 => 2 (Pair)        0.20={"1":2}              JSONX=ArgumentError
   Dict / Vector / Tuple / NamedTuple / Set       identical
   kwargs (Base.Pairs)  0.20={"a":1,…}            JSONX={"a":1,…}
```

**JSON 1.8 adds a *third* behaviour** for the same inputs: `src/write.jl:529` has
`allownan::Bool = false` and `:860` `infcheck(x, allownan)` **throws** on `NaN`/`Inf`. So without
normalization there would be three different answers for the same input across three backends.
**This is the strongest argument for the pre-lowering design** — `_to_plain` makes all three
produce today's bytes.

`Pair` is deliberately left out: 0.20's `{"1":2}` for a bare `Pair` is odd and no caller was
found relying on it; it now raises the "define `JSONRPC.lower`" error. The DEL difference is
cosmetic — both forms round-trip through JS `JSON.parse` to the same string.

### 3.3 Two deliberate non-changes

- **`missing` is NOT omitted inside containers**, only in `Outbound` structs.
  `scripts/packages/VSCodeServer/src/display.jl:89-90` builds
  `Dict{String,Any}("kind"=>…, "data"=>…, "id"=>id, "title"=>title)` with `id=missing,
  title=missing` defaults, which 0.20 wrote as `null`. Omitting them would silently change the
  `display` notification shape. The omission stays exactly where it is today, in the `Outbound`
  method.
- **`Dates` is left out** — JSONRPC has no `Dates` dep today. Adding
  `_to_plain(x::Dates.TimeType) = string(x)` is two lines against a free stdlib and removes a
  silent-behaviour-change class entirely. No LSP/DAP/TestItemController payload carrying a `Date`
  was found, so either choice is defensible; adding it is the safer one.

Not handled, same as 0.20: `Base.Generator` and lazy iterators (0.20 also required
`AbstractVector`/`Tuple`).

### 3.4 The residual `jsoncompat.jl`

All 18 current lines are replaced by:

```julia
@static if nameof(JSON) === :JSONX
    # Vendored zero-dependency backend. Everything reaching it is already plain.
    _json_parse(str) = JSON.parse(str)                              # already Dict{String,Any}
else
    _json_parse(str) = JSON.parse(str; dicttype=Dict{String,Any})   # JSON 1.x
end

const JSONText = JSON.JSONText

_serialize_json(value) = JSON.json(_to_plain(value))
_parse_json(value)     = _json_parse(value)
```

`nameof(JSON) === :JSONX` works because the include-sites bind `const JSON = JSONX`, and `nameof`
on a module returns its own name regardless of the alias (verified on 1.0.5 / 1.6.7 / 1.13.0,
along with the fact that `import ..JSON` resolves through a `const JSON = SomeModule` alias on all
three).

A more robust alternative, if keying off a name feels fragile: `@static if !isdefined(JSON, :lower)`
— JSONX has no `lower`, both 0.20 and 1.x do. The `nameof` form is more explicit about intent.

`JSONSerialization` and `DefaultJSONSerialization` disappear. `JSONText` is re-exported as a
JSONRPC-level const so `_to_plain` can dispatch on it uniformly across backends.

### 3.5 `core.jl` edits

| line | before | after |
|---|---|---|
| 189 | `JSONRPCEndpoint{IOIn<:IO,IOOut<:IO,S<:JSONSerialization,F<:FramingMode}` | `JSONRPCEndpoint{IOIn<:IO,IOOut<:IO,F<:FramingMode}` |
| 209 | `serialization::S` | *deleted* |
| 228 | `JSONRPCEndpoint(pipe_in, pipe_out, serialization::JSONSerialization=DefaultJSONSerialization(); framing=ContentLengthFraming())` | `JSONRPCEndpoint(pipe_in, pipe_out; framing=ContentLengthFraming())` |
| 242 | `serialization,` (positional arg to inner constructor) | *deleted* |
| 619, 635 | `_serialize_json(x.serialization, message)` | `_serialize_json(message)` |
| 837, 851 | `_serialize_json(endpoint.serialization, response)` | `_serialize_json(response)` |
| 499 | `_parse_json(message)` | unchanged |

`packagedef.jl:13` → `E = JSONRPCEndpoint{Base.PipeEndpoint, Base.PipeEndpoint, ContentLengthFraming}`.

Dropping the third positional argument deliberately turns `JSONRPCEndpoint(a, b, SomeStyle())`
into a `MethodError` rather than silently treating it as something else. That is the intended
4.0 break.

Verified two-argument production call sites (unaffected):
`LanguageServer/src/languageserverinstance.jl:103`,
`TestItemControllers/src/jsonrpctestitemcontroller.jl:75`,
`TestItemControllers/src/testprocess.jl:535`,
`TestItemControllers/testprocess/TestItemServer/src/TestItemServer.jl:1448`,
`JuliaWorkspaces/src/dynamic_feature/dynamic_feature.jl:345`,
`JuliaWorkspaces/juliadynamicanalysisprocess/…/JuliaDynamicAnalysisProcess.jl:155`,
`VSCodeServer/src/serve_notebook.jl:91`, `VSCodeServer/src/VSCodeServer.jl:169,253`.

### 3.6 Test changes in JSONRPC

**`test/test_json_serialization.jl`** — the `@static if isdefined(JSON, :JSONStyle)` block and
`using JSON` go; the test becomes backend-independent and keeps its assertions verbatim:

```julia
@testitem "Custom JSONRPC.lower" setup=[NamedPipes] begin
    struct OurStruct
        a::String
        b::String
    end
    JSONRPC.lower(f::OurStruct) = "$(f.a):$(f.b)"

    ep2 = JSONRPCEndpoint(socket1, socket1)      # was: (socket1, socket1, OurSerialization())
    ep1 = JSONRPCEndpoint(socket2, socket2)      # was: (socket2, socket2, OurSerialization())
    …
    @test err_msg.data == Any["Hello:World"]
    @test msg1.params == ["Hello:World"]         # unchanged
end
```

Defining a method on `JSONRPC.lower` from inside a `@testitem` module is legal (an explicit
qualified method definition), same as the current test defines `JSON.show_json`.

**`test/test_misc.jl:197-210`** — `@testitem "endpoint constructor default serialization"` loses
its reason to exist; drop `using JSON` and lines 201-205, keep the status/err/task assertions,
rename to `"endpoint constructor defaults"`.

**New `test/test_lower.jl`** covering `_to_plain` directly: `missing` omitted from `Outbound` but
`null` inside a `Dict`; nested `Outbound` in a `Vector` in a `Dict`; `NamedTuple` → object;
`NaN`/`Inf` → `null`; `1//3` → `0.3333333333333333`; `Symbol`/`Enum`/`Char` → string; non-`String`
`Dict` keys stringified; `JSONText` spliced raw; a type with no `lower` method raising
`ArgumentError` with a useful message.

**Tests that build raw wire frames with `JSON` directly** — `test_interface_def.jl:21,22,28,33`
(`Foo(JSON.parse(JSON.json(a)))`) and many `@testitem`s in `test_coverage_gaps.jl` (lines 979,
1002, 1006, 1103, 1121, 1125, 1143, 1167, 1177, 1182, 1229, 1243, 1259, 1267, 1282, 1290, 1306,
1312-1313, 1333, 1339, 1381, 1405, 1409) — should switch to `JSONRPC._serialize_json` /
`JSONRPC._parse_json` so the suite exercises whichever backend is in play instead of pulling a
second, possibly different, JSON into the test env. Mechanical, and removes `JSON` from JSONRPC's
test dependencies.

### 3.7 `@dict_readable` / `typed.jl` need no change (verified)

| input | JSON 0.20 | JSONX |
|---|---|---|
| `1` | `1::Int64` | `1::Int64` |
| `1.0` | `1.0::Float64` | `1.0::Float64` |
| `-0` | `0::Int64` | `0::Int64` |
| `1e3` | `1000.0` | `1000.0` |
| `[1,2]` | `Any[1,2]` | `Any[1,2]` |
| `{"a":1}` | `Dict{String,Any}` | `Dict{String,Any}` |
| `"é"` | `"é"` | `"é"` |
| `12345678901234567890` | `-6101065172474983726` (**wraps**) | `1.2345678901234567e19` |

Integer narrowing is identical, so `field_type`'s `$(fieldtype)(dict[$fieldname])` conversions
(`interface_def.jl:62-70`) behave the same, and `typed.jl:68`/`:143`'s `param_type(msg.params)`
and `convert(param_type, (;…))` paths are untouched. The only divergence is Int64 overflow, where
JSONX is strictly better. `_parse_json` normalizes the dict type on both backends, so
`Request.params::Union{Nothing,Dict{String,Any},Vector{Any}}` (`core.jl:157`) still holds.

---

## 4. Per-consumer changes

### 4.1 LanguageServer

- `src/LanguageServer.jl:2` — delete `using JSON`.
- `src/LanguageServer.jl:24` — `JSON.lower(uri::URI) = string(uri)` → `JSONRPC.lower(uri::URI) = string(uri)`.
  (`JSONRPC` is already imported at line 5.) `const DocumentUri = URI` (`protocol/basic.jl:29`), so
  this one method covers every `uri`/`targetUri` field.
- `src/protocol/basic.jl:45` — `function JSON.lower(a::Range)` → `function JSONRPC.lower(a::Range)`.
  Body unchanged (`Dict("start" => a.start, "end" => a.stop)`) — `_to_plain` recurses into the
  returned Dict and lowers the two `Position`s, which *are* `Outbound`.
- `Project.toml` — remove `JSON` from `[deps]` (line 7) and `[compat]` (line 19); bump
  `JSONRPC = "3"` → `"4"`.
- `test/test_communication.jl:2,5` and `test_out_of_workspace_diagnostics.jl:7,18` use `JSON.parse`
  to inspect frames — switch to `JSONRPC._parse_json`.

Checked: no `URI` ever reaches `_to_plain_key`. `Dict{URI,…}` appears only in server-internal state
(`languageserverinstance.jl:74,75,83,91`, `testitem_diagnostic_marking.jl:97`) and in
`requests/features.jl:83`, where only `collect(values(tdes))` is returned. It would work anyway.

### 4.2 DebugAdapter / DAPRPC

DAPRPC is a self-contained mini-JSONRPC inside DebugAdapter (`src/DAPRPC/`) with **no**
serialization type parameter (`core.jl:5`, `DAPEndpoint{IOIn,IOOut}`), so the change is smaller —
but it needs its own copy of the machinery, because DebugAdapter does not depend on JSONRPC.

`src/DAPRPC/interface_def.jl:3-22` — delete both the `JSON.Writer.CompositeTypeWrapper` constructor
overload and the `JSON.lower` method, replace with DAPRPC-local equivalents:

```julia
abstract type Outbound end

lower(x) = x

function lower(a::Outbound)
    nfields(a) == 0 && return nothing
    fields = Dict{String,Any}()
    for field in fieldnames(typeof(a))
        value = getfield(a, field)
        ismissing(value) || (fields[string(field)] = value)
    end
    return fields
end
```

plus a copy of `_to_plain` (vendored as `src/DAPRPC/lower.jl`).

`src/DAPRPC/core.jl`:

| line | before | after |
|---|---|---|
| 105 | `message_dict = JSON.parse(message)` | `message_dict = _parse_json(message)` |
| 154, 173 | `message_json = JSON.json(message)` | `message_json = _serialize_json(message)` |
| 218, 230 | `response_json = JSON.json(response)` | `response_json = _serialize_json(response)` |

`Project.toml` — remove `JSON` from `[deps]` and `[compat]`; bump major (the `Outbound`
serialization hook changes).

`test/test_debugsession.jl:2,39,54` uses `JSON.json`/`JSON.parse` — point at
`DebugAdapter.DAPRPC._serialize_json` / `._parse_json`.

**Behaviour note:** `CompositeTypeWrapper(t::Outbound)` preserves *field declaration order* in the
emitted object; a `Dict{String,Any}` does not. JSON objects are unordered and every DAP client
parses by key, so this is safe — but the DAP wire bytes change order, which would break any
byte-comparison golden test.

### 4.3 TestItemControllers

`src/results.jl:204` is the sharpest edge in the whole change:

```julia
write_json(io::IO, result::TestrunResult) = JSON.print(io, result)
```

`TestrunResult` is a bare struct with no `lower` method. This works today *purely* because JSON
0.20's `lower(a)` falls back to `CompositeTypeWrapper(a)` for anything with `nfields > 0`,
recursively, so the entire nested result tree is reflected onto the wire by field name. JSONX has
no such fallback, and neither does `JSONRPC._to_plain`.

Replacement: make the schema explicit, mirroring the `_testrun_result` / `_testitem` / `_profile` /
`_message` / `_stack_frame` / `_perf_stats` / `_definition_error` / `_file_coverage` readers that
already exist at `results.jl:226-274`. Roughly 45 lines, one `_lower` per struct:

```julia
write_json(io::IO, result::TestrunResult) = print(io, JSON.json(_lower(result)))

_lower(x::TestrunResultStackFrame) = Dict{String,Any}(
    "label" => x.label, "uri" => x.uri, "line" => x.line, "column" => x.column)

_lower(x::TestrunResultMessage) = Dict{String,Any}(
    "message"         => x.message,
    "expected_output" => x.expected_output,
    "actual_output"   => x.actual_output,
    "uri"             => x.uri,
    "line"            => x.line,
    "column"          => x.column,
    "stack_frames"    => x.stack_frames === nothing ? nothing : _lower.(x.stack_frames))

_lower(x::TestrunResultPerfStats) = Dict{String,Any}(
    "elapsed"        => _finite(x.elapsed),
    "bytes"          => x.bytes,
    "allocs"         => x.allocs,
    "gctime"         => _finite(x.gctime),
    "compile_time"   => _finite(x.compile_time),
    "recompile_time" => _finite(x.recompile_time))

_lower(x::TestrunResultTestitemProfile) = Dict{String,Any}(
    "profile_name" => x.profile_name,
    "status"       => String(x.status),           # was Symbol -> string via 0.20
    "duration"     => _finite(x.duration),
    "messages"     => x.messages === nothing ? nothing : _lower.(x.messages),
    "output"       => x.output,
    "perf"         => x.perf === nothing ? nothing : _lower(x.perf))
# … also TestrunResultTestitem, TestrunResultDefinitionError,
#   TestrunResultFileCoverage, TestrunResult

_finite(x) = x === nothing || isfinite(x) ? x : nothing
```

**Key names must match the reader exactly** (`"expected_output"`, `"stack_frames"`,
`"profile_name"`, `"process_outputs"`, `"definition_errors"`, `"testitems"`, `"coverage"`). The
reader is the spec; a mismatch breaks `julia-report-ci-results` merging files across a CI matrix,
which `results.jl:220-223` explicitly calls out as a compatibility requirement.

The `_finite` guard is new and genuinely needed: `TestrunResultPerfStats.elapsed::Union{Nothing,Float64}`
comes from timing code, and 0.20 wrote `null` for a `NaN`; JSONX would write the literal `NaN` into
a file `read_json` then cannot parse.

Other TestItemControllers changes:

- `src/results.jl:216,217` — `JSON.parse(read(io, String))` and `JSON.parsefile(path)` need **no
  change**; JSONX has both.
- `src/precompile.jl:80` — `JSON.parse(JSON.json(Dict(…)))` works unchanged on JSONX.
- `shared/testserver_protocol.jl:20` — `function JSON.lower(a::Range)` → `function JSONRPC.lower(a::Range)`.
  `:4`'s `import ..JSONRPC.JSON` can stay or be dropped once line 20 changes.
- `src/TestItemControllers.jl:7` — the JSON include becomes the jsonx include (§5).

### 4.4 IJuliaCore

- `src/display.jl:86` — `display_mimejson(m::MIME, x) = (m, JSON.JSONText(limitstringmime(m, x)))`
  needs **no textual change**; `JSONX.JSONText` and JSON 1's `JSON.JSONText` both exist and both
  splice raw.
- `src/display.jl:94` — `data = Dict{String, Union{String, JSONText}}()` **does break**. It uses the
  *unqualified* name, which today comes from `using JSON` (`IJuliaCore.jl:3`) because JSON 0.20
  does `export JSONText` (`JSON/src/JSON.jl:6`). **JSONX has no `export` statements at all**
  (`names(JSONX) == [:JSONX]`, verified). Under `const JSON = JSONX`, `using ..JSON` imports nothing
  and line 94 raises `UndefVarError(:JSONText)` at load time.

  Fix: qualify it — `Dict{String, Union{String, JSON.JSONText}}()` — so the vendored file stays
  byte-identical to upstream apart from the mandatory §2 patch. (The alternative, adding
  `export json, JSONText` to the vendored copy, creates a second local delta.)

  **Worth flagging loudly:** this is a load-time failure, in a file nobody would think to grep, and
  it only shows up on the `notebookdisplay.jl` path.

- `Project.toml` — `[compat] JSON = "0.18,0.19,0.20,0.21,1"` → `"1"` if IJuliaCore keeps the dep for
  standalone use; inside VSCodeServer it is satisfied by the alias.

Note that `display_dict` values flow straight into `JSONRPC.send_notification`
(`VSCodeServer/src/notebookdisplay.jl:32-35`), so **`_to_plain` passing `JSONText` through
untouched is a hard requirement, not a nicety.**

### 4.5 VSCodeServer

- `src/misc.jl:197` — `vscode_cmd_uri(cmd; cmdargs...) = string("command:", cmd, '?', encode_uri_component(JSON.json(cmdargs)))`.
  `cmdargs` is a `Base.Pairs <: AbstractDict` and JSONX's `write_object` handles it; verified
  byte-identical on both backends. **No change needed.**
- `src/VSCodeServer.jl:13` — the JSON include becomes the jsonx include (§5).
- `src/tables/tableviewer.jl` — §5.

---

## 5. The tableviewer rewrite (highest-risk piece)

`scripts/packages/VSCodeServer/src/tables/tableviewer.jl` makes ~30 calls into JSON 0.20's
`Writer` streaming API: `JSON.Writer.CompactContext` (`:50,:241,:301`),
`JSON.StandardSerialization()` (`:54,:67,:110`), `begin_object`/`end_object`, `begin_array`/`end_array`,
`show_key`, `show_pair`, `delimit`, and `JSON.JSONText` (`:244,:310`). None of it exists in JSONX.

### 5.1 What the writer actually sees

The saving observation is `tableviewer.jl:24`:

```julia
json_sprint(x) = sprint(print, x)
```

and `print_el` (`:109-118`):

```julia
if val isa Real && isfinite(val) && _is_javascript_safe(val)
    JSON.show_pair(ctx, ser, name, val)               # Real, finite, |x| < 2^53
elseif val === nothing || val === missing
    JSON.show_pair(ctx, ser, name, repr(val))         # "nothing" / "missing" as strings
else
    JSON.show_pair(ctx, ser, name, json_sprint(val))  # String
end
```

So the body writer only ever emits `String` or a finite JS-safe `Real`. The schema writer
(`:66-89`) emits `String`, `String`-or-`nothing`, `Bool`-or-`String` (`ag_filter_type` returns
`true` or `"agNumberColumnFilter"`/`"agDateColumnFilter"`), and `Bool`. **The complete value
domain is `String`, `Real`, `Bool`, `Nothing`.**

### 5.2 Replacement: new `scripts/packages/VSCodeServer/src/tables/compactjson.jl`

```julia
# A minimal streaming compact-JSON writer. This is the small part of JSON 0.20's
# `JSON.Writer.CompactContext` that the table viewer used: enough to emit a large
# table incrementally into an `IOBuffer` without ever materializing it as one value.
#
# The value domain is deliberately tiny — `print_el` stringifies every cell that is
# not a finite, JavaScript-safe `Real` before it gets here (see `json_sprint`).

# `write_string` is an internal of the vendored jsonx.jl. Re-syncing that file must
# check this still exists.
isdefined(JSONX, :write_string) ||
    error("vendored JSONX no longer provides `write_string`; see JSONX_VENDORING.md")

mutable struct CompactWriter{T<:IO} <: IO
    io::T
    first::Bool
end
CompactWriter(io::IO) = CompactWriter(io, false)

# Comma before every element but the first; `begin_*` arms the flag, `end_*` clears it,
# exactly as JSON 0.20's `delimit`/`begin_object`/`end_object` did.
delimit(w::CompactWriter)      = (w.first || print(w.io, ','); w.first = false; nothing)
begin_object(w::CompactWriter) = (print(w.io, '{'); w.first = true;  nothing)
end_object(w::CompactWriter)   = (print(w.io, '}'); w.first = false; nothing)
begin_array(w::CompactWriter)  = (print(w.io, '['); w.first = true;  nothing)
end_array(w::CompactWriter)    = (print(w.io, ']'); w.first = false; nothing)

show_key(w::CompactWriter, k) = (delimit(w); JSONX.write_string(w.io, string(k)); print(w.io, ':'); nothing)

show_value(w::CompactWriter, ::Nothing)         = print(w.io, "null")
show_value(w::CompactWriter, x::Bool)           = print(w.io, x ? "true" : "false")
show_value(w::CompactWriter, x::Real)           = isfinite(x) ? print(w.io, x) : print(w.io, "null")
show_value(w::CompactWriter, x::AbstractString) = JSONX.write_string(w.io, x)
# Defensive: column labels come from `DataAPI.colmetadata`, which can return anything.
show_value(w::CompactWriter, x)                 = JSONX.write_string(w.io, sprint(print, x))

show_pair(w::CompactWriter, k, v) = (show_key(w, k); show_value(w, v); nothing)
```

27 lines. `include("compactjson.jl")` goes next to `include("filtering.jl")` at `tableviewer.jl:3`.

**On depending on `JSONX.write_string`** — it is an internal, not part of the documented JSONX
surface. That is acceptable here for three reasons: (a) we own the vendored copy and update it
deliberately, not via a resolver, so upstream cannot break us silently; (b) the alternative is a
second, divergent copy of JSON string escaping in this repo, which is strictly worse; (c) the
`isdefined` guard makes the risk a loud load-time failure rather than a silent one.

One escaping difference: `JSONX.write_string` escapes `< 0x20` but leaves `0x7f` (DEL) raw, where
0.20 emitted `\u007f`. Both are valid JSON and JS `JSON.parse` accepts both.

### 5.3 Call-site conversion

Purely mechanical: `ctx` → `w`, drop the `ser = JSON.StandardSerialization()` locals, drop the
`JSON.` qualifier and the `ser` argument.

```julia
# BEFORE                                          # AFTER
function print_table(io::IO, source, …)           function print_table(io::IO, source, …)
    ctx = JSON.Writer.CompactContext(io)              w = CompactWriter(io)
    JSON.begin_object(ctx)                            begin_object(w)
    JSON.show_pair(ctx, JSON.StandardSerialization(), "name", title)
                                                      show_pair(w, "name", title)
    JSON.show_key(ctx, "schema")                      show_key(w, "schema")
    print_schema(ctx, col_names, …)                   print_schema(w, col_names, …)
    JSON.show_key(ctx, "data")                        show_key(w, "data")
    print_body(ctx, source, fixed_col_names)          print_body(w, source, fixed_col_names)
    JSON.end_object(ctx)                              end_object(w)
end                                               end
```

`print_schema` (`:66-89`), `print_body` (`:91-107`) and `print_el` (`:109-118`) convert identically.

**Both `JSONText` splice sites are unchanged.** At `:240-252`:

```julia
io = IOBuffer()
w = CompactWriter(io)                            # was: ctx = JSON.Writer.CompactContext(io)
print_schema(w, col_names, …)
schema = JSON.JSONText(String(take!(io)))        # unchanged
payload = (schema = schema, rowCount = …, name = title, id = string(id))
sendDisplayMsg("application/vnd.dataresource+lazy", JSON.json(payload))   # unchanged
```

`JSON.json` on a `NamedTuple` containing a `JSONText` works on JSONX: `write_json` checks
`value isa JSONText` *before* `AbstractString` and before the object/array branches, and splices
`value.text` raw. Same at `:300-312` for `rows = JSON.JSONText(String(take!(io)))`, which goes out
through `send_success_response` → `_to_plain` → `Dict{String,Any}("rows" => JSONText, "lastRow" => Int)`.

### 5.4 Streaming is preserved

Nothing in this design collects rows. `print_body` iterates `source` and writes into the
`IOBuffer` one row at a time, exactly as today; `showtable`'s async path (`:232-257`) still only
serializes the *schema* eagerly and hands row fetching to `get_table_data_request`, which windows
via `params.startRow`/`endRow`. The `MAX_SYNC_TABLE_ELEMENTS = 100_000` /
`MAX_CACHE_TABLE_ELEMENTS = 10_000_000` thresholds (`:181-182`) are unaffected.

### 5.5 Output verified byte-identical

Running both pipelines over a table with a dotted column name, an embedded `"` in a column name,
an embedded newline in a cell, a `NaN` cell, a `1e300` cell, a `nothing` cell, a `nothing` label
and a `String` label:

```
IDENTICAL: true
{"name":"My Table","schema":{"fields":[{"name":"a_b","title":"a.b","type":"integer",
"jl_type":"Int64","jl_label":null,"ag_type":"numericColumn","ag_filter":"agNumberColumnFilter",
"ag_sortable":false},…]},"data":[{"a_b":1,"col2":2.5,"weird\"q":"hi"},
{"a_b":2,"col2":"NaN","weird\"q":"b\nc"},{"a_b":3,"col2":"1.0e300","weird\"q":"nothing"}]}
```

---

## 6. Vendoring mechanics

### 6.1 Constraint set

`jsonx.jl` has to be reachable from the five include-sites in §1, *and* from JSONRPC and
DebugAdapter **as standalone registered packages** — because
`scripts/testenvironments/debugadapter/v1.0` … `v1.9` exist and JSON 1 needs Julia ≥ 1.10 (§7.1).
It must not collide with a real `JSON` when JSONRPC is used on JSON 1.

### 6.2 Placement: canonical copy in `scripts/packages/JSONRPC/src/jsonx.jl`

JSONRPC is already what every one of the five include-sites drags in (via
`include(".../JSONRPC/src/packagedef.jl")`), and it is already subtree-vendored into
TestItemControllers (`packages/JSONRPC`) and JuliaWorkspaces (`packages/JSONRPC`). Putting jsonx
there means the copies propagate automatically with the existing subtree machinery, and the three
`packages/JSON` copies all go away at once.

```julia
# scripts/packages/JSONRPC/src/JSONRPC.jl
module JSONRPC
import UUIDs, CancellationTokens, Sockets
include("jsonx.jl")
const JSON = JSONX        # keeps `import ..JSONRPC.JSON` working (testserver_protocol.jl:4)
include("packagedef.jl")
end
```

`JSON` leaves JSONRPC's `[deps]` entirely. The five include-sites become:

```julia
include("../../JSONRPC/src/jsonx.jl")    # defines module JSONX
const JSON = JSONX
```

and the `module JSONRPC … import ..JSON … include(".../packagedef.jl") end` wrappers stay exactly
as they are — `packagedef.jl` already assumes `JSON` is provided by the enclosing module.

`VSCodeDebugger` (which has no JSONRPC) can include `../../JSONRPC/src/jsonx.jl`, since the
JSONRPC submodule is present in julia-vscode. `DebugAdapter` standalone needs its **own** copy at
`scripts/packages/DebugAdapter/src/DAPRPC/jsonx.jl`, because its repo cannot reach into JSONRPC's.

Net: **two** tracked copies of the file in this tree (JSONRPC's and DebugAdapter's), plus the
automatic subtree copies. Down from three today.

*Alternative considered:* a repo-level `scripts/packages/JSONX/` directory replacing
`scripts/packages/JSON`. It keeps include paths shaped like today and gives a natural home for a
re-sync README — but it is three copies instead of two, and nothing in the extension needs JSONX
as a *package*.

### 6.3 No `Project.toml` for the vendored file

Nothing loads it via `import`/Pkg; every consumer `include`s it. A Project.toml would mean a
package UUID, a registry-collision question, and a fourth thing to keep in sync, for no benefit.
(`scripts/packages/JSON` needed one only because JSONRPC/LanguageServer/IJuliaCore depended on it
through `[sources]`.)

### 6.4 Keep the module named `JSONX`

Verbatim. Renaming it to `JSON` inside the file would make
`diff upstream/vendor/jsonx.jl scripts/packages/JSONRPC/src/jsonx.jl` noisy forever, and the
aliasing (`const JSON = JSONX`) is one line at each of the seven sites. Keeping the name is also
what makes `@static if nameof(JSON) === :JSONX` a legitimate discriminator rather than a hack.

Record the §2 patch as a one-line delta in `scripts/packages/JSONRPC/src/JSONX_VENDORING.md`, so a
re-sync is `curl` + re-apply + run the differential test.

### 6.5 Update tooling and `.gitmodules`

- `scripts/packages/TestItemControllers/scripts/update_vendored_packages.jl:15` and
  `scripts/packages/JuliaWorkspaces/scripts/update_vendored_packages.jl:14` both carry the
  `# "JSON" => "", We skip this…` line — **both get deleted** together with the `packages/JSON`
  subtrees. These are `git subtree`s, not submodules (neither repo has a `.gitmodules`), so
  `git rm -r packages/JSON` in each is the whole operation.
- Because jsonx lives inside JSONRPC, `"JSONRPC" => "julia-vscode/JSONRPC.jl"` in both scripts now
  carries jsonx updates along for free. **That is the main argument for this placement.**
- `.gitmodules` — exactly **one** entry to remove:
  ```
  [submodule "scripts/packages/JSON"]
  	path = scripts/packages/JSON
  	url = https://github.com/JuliaIO/JSON.jl.git
  ```
  plus `git rm scripts/packages/JSON`. Contributors with existing clones need
  `git submodule deinit scripts/packages/JSON` and stale `submodule.scripts/packages/JSON.*` keys
  removed from `.git/config` — worth a note in the PR description, since this is not automatic.

---

## 7. Environments, CI, and the open question about JSON 1

### 7.1 The constraint that decides the shape

`scripts/testenvironments/debugadapter/v1.0/Project.toml` lists `DebugAdapter`, `JSONRPC`, `JSON`,
on Julia 1.0, and `.github/workflows/main.yml:231` runs `Pkg.test("DebugAdapter")` for
`['1.0','1.1',…,'1.12']`. **JSON 1 requires Julia ≥ 1.10.** Combined with dropping 0.20 compat,
that forces:

> **JSONRPC and DebugAdapter must have no `JSON` dependency at all** — they vendor `jsonx.jl` and
> use it unconditionally in the package path.

### 7.2 Where `JSON` is a real package dependency today

| environment | Julia versions | why |
|---|---|---|
| `scripts/environments/development` | release | `JSON` + `JSONRPC` in `[deps]` |
| `scripts/environments/languageserver/{fallback,v1.11,v1.12,v1.13}` | ≥ 1.11 | `JSON` in `[deps]`, `[sources]`, Manifest |
| `scripts/testenvironments/debugadapter/v1.0 … v1.13` | 1.0 – 1.13 | `DebugAdapter` + `JSONRPC` + `JSON` |

`scripts/environments/testitemcontroller/*`, `scripts/environments/terminalserver/*`,
`scripts/testenvironments/vscodeserver/*` and `scripts/testenvironments/vscodedebugger/*` have
**no** JSON — those packages vendor everything by `include`, so JSON simply drops out of them.

`scripts/environments/pkgdev/*` has JSON via `GitHub.jl`/`PkgButlerEngine` from the registry —
**unrelated, leave alone.**

### 7.3 Concrete environment changes

- `scripts/environments/languageserver/{fallback,v1.11,v1.12,v1.13}/Project.toml` — delete
  `JSON = "682c06a0-de6a-54ab-a142-c8b1cf79cde6"` from `[deps]` and
  `JSON = {path = "../../../packages/JSON"}` from `[sources]`.
- The matching `Manifest.toml`s are **regenerated, not hand-edited** — the `[[deps.JSON]]` stanzas
  (fallback:183-190, v1.11:121-125, v1.12:126-130, v1.13:126-130) and the `"JSON"` entries in
  `deps = […]` for `JSONRPC` and `LanguageServer` vanish on re-resolve.
- `scripts/environments/development/Project.toml:16` — drop `JSON`.
- `scripts/testenvironments/debugadapter/v*/Project.toml` — drop the `JSON` line from all fourteen.
- `src/scripts/juliaprojectcreatescripts/create_ls_project.jl:18` — delete
  `PackageSpec(path="../../../packages/JSON"),`.
- `src/scripts/juliaprojectcreatescripts/create_test_debugadapter_project.jl:26` — same deletion.
- `src/scripts/updateDeps.ts` — **no change needed** (no `JSON` string appears; the path handling
  is generic). Re-running it is what regenerates all the manifests above.

### 7.4 JSONRPC CI

- **Delete** `scripts/packages/JSONRPC/.github/workflows/juliaci-oldjson.yml` (108 lines),
  `.ci/force_json_020.jl` and `.ci/verify_json_020.jl`. Their entire premise — *"the VS Code
  extension uses JSON 0.20 on all Julia versions because it is the last JSON version without
  non-stdlib dependencies"* — is what this change retires. (Those `.ci` scripts avoid the TOML
  stdlib specifically so they can run on Julia 1.0.)
- `juliaci.yml` keeps testing the default (now vendored JSONX) backend across all compatible
  Julia minors. With no JSON in `[deps]`, that resolve becomes trivial.
- **Add** a JSON-1 leg on Julia ≥ 1.10 only, if JSON 1 stays a supported backend — see below.

### 7.5 OPEN: where real JSON 1 gets used

Given §7.1, the question narrows to *how JSONRPC can still offer a JSON-1 backend at all*, since
it can no longer declare `JSON` as a hard dep.

**Option A — JSONX everywhere in the extension; JSON 1 is a CI-validated backend.**
JSONRPC has no `JSON` in `[deps]`. The backend is whatever the enclosing module bound, defaulting
to the vendored JSONX. A CI leg on Julia ≥ 1.10 constructs a module with `import JSON` before
including `packagedef.jl` and runs the suite against JSON 1.8.
*Cost to the extension: zero new submodules; `scripts/packages/JSON` just goes away and every
environment gets smaller.*
*Honest caveat: the abstraction becomes near-vestigial. If nobody ever runs the JSON-1 backend, it
is a compatibility promise rather than a feature — and deleting the branch entirely would simplify
`jsoncompat.jl` to nothing.*

**Option B — ship real JSON 1 in the ≥ 1.11 environments.**
Would need `Parsers` and `StructUtils` as new submodules (`PrecompileTools` is **already** one at
`scripts/packages/PrecompileTools`) and repointing `scripts/packages/JSON` from v0.20.1 to v1.8.x.
But it cannot hang off JSONRPC (Julia 1.0 envs), so it would have to hang off **LanguageServer** —
which, once `JSON.lower` → `JSONRPC.lower`, no longer needs JSON at all. **Appears dominated**
unless there is an LS-environment consumer of JSON 1 that was not found during exploration.

**Option C — backend as a value, JSON 1 as a package extension.**
Replace the `const JSON = …` compile-time switch with a runtime-dispatched backend:
`abstract type JSONBackend end`, `struct JSONXBackend <: JSONBackend end` in JSONRPC, and a
`JSONRPCJSONExt` weakdep extension (Julia ≥ 1.9) adding `JSON1Backend` plus its `_json_string` /
`_json_parse` methods. The endpoint carries the backend value.
*Pros:* genuinely optional JSON 1, no new submodules, works for downstream users who already have
JSON 1 loaded.
*Cons:* reintroduces an endpoint type parameter we just deleted (a much thinner one); weakdeps need
Julia ≥ 1.9, so the pre-1.9 path is JSONX-only anyway; more machinery than a one-`const` switch.

**Recommendation: A**, unless there is a concrete consumer for the JSON-1 backend, in which case **C**.

### 7.6 Version bumps

| package | change |
|---|---|
| `scripts/packages/JSONRPC/Project.toml` | `version = "4.0.0-DEV"`; drop `JSON` from `[deps]` + `[compat]` |
| `scripts/packages/DebugAdapter/Project.toml` | bump major (`Outbound` hook changes); drop `JSON` |
| `scripts/packages/LanguageServer/Project.toml` | drop `JSON`; `JSONRPC = "4"` |
| `scripts/packages/JuliaWorkspaces/Project.toml` | `JSON` is only in `[extras]` — check `test/` usage, drop if unused |
| `scripts/packages/IJuliaCore/Project.toml` | `JSON = "0.18,…,1"` → `"1"` |

`scripts/packages/JSONRPC/CHANGELOG.md` needs a `# Version v4.0.0` block with both breaking items
— the `serialization` argument removal and the `JSON.lower` → `JSONRPC.lower` migration — with a
before/after snippet, since downstream LanguageServer/DebugAdapter authors read it.

---

## 8. Risks

### 8.1 Invalid UTF-8 — a new failure class

VSCodeServer pipes REPL/stdout bytes through JSON.

| input bytes | JSON 0.20 | JSONX |
|---|---|---|
| `[0x61,0xff,0xfe,0x62]` | `BoundsError` (a 0.20 bug) | `InvalidCharError('\xff')` |
| `[0x80]` | `"\x80"` (passes bytes through) | `InvalidCharError('\x80')` |

0.20 was *sometimes* lossy-but-silent; JSONX **always throws**, because `write_string` does
`for c in str … Int(c) …` and `Int` on a malformed `Char` raises. If any code path can hand JSONRPC
a `String` with invalid UTF-8, this turns a silent corruption into a thrown error that kills the
write. Mitigate at the VSCodeServer output-capture boundary (preferred) or in
`_to_plain(x::AbstractString)`.

**The REPL output paths were not audited — this must be a review item.**

### 8.2 Performance

Measured on Julia 1.13, JSONX vs vendored 0.20, same input:

| workload | 0.20 | JSONX | ratio |
|---|---|---|---|
| write LSP `didChange` (17 KB) | 0.085 ms | 0.100 ms | 1.18× |
| write `publishDiagnostics`, 500 diags (79 KB) | 0.470 ms | 0.445 ms | 0.95× |
| write 420 KB string with escapes | 2.3 ms | 2.1 ms | 0.91× |
| write 690 KB unicode string | 3.4 ms | 3.15 ms | 0.93× |
| write 200 000 small strings (tableviewer-shaped) | 15.8 ms | 20.8 ms | **1.32×** |
| **parse** `didChange` | 0.045 ms | 0.080 ms | **1.78×** |
| **parse** `publishDiagnostics` | 0.285 ms | 0.455 ms | **1.60×** |

- **Writing is a wash.** The `isa` chain costs ~30 % on many-small-values workloads and nothing on
  string-dominated ones. Upstream's "clarity over performance" note is mostly about the parser.
- **Parsing is 1.6–1.8× slower.** That lands on the LS inbound path (`core.jl:499`), the hottest
  JSON path in the extension — every `didChange` on every keystroke. At 0.08 ms for a 17 KB
  document this should not be felt, but it is the number to watch.
- **`_to_plain` is a new cost** not in the table: a fresh `Dict{String,Any}`/`Vector{Any}` per
  container per outbound message. For messages already built as `Dict{String,Any}` of plain values
  (most notifications) this roughly doubles pre-serialization allocation. **Do not pre-optimize.**
  If it shows up, the cheap fix is an identity fast path:
  ```julia
  function _to_plain(x::Dict{String,Any})
      all(_is_plain, values(x)) && return x   # no copy
      return Dict{String,Any}(k => _to_plain(v) for (k, v) in x)
  end
  ```
- **tableviewer is unaffected** — it never goes through `json()`; it streams through `CompactWriter`
  into an `IOBuffer` exactly as before, and `JSONX.write_string` measured the same as 0.20's
  `ESCAPED_ARRAY` path on large strings.
- **Test result files** get *faster* if anything, since the explicit `_lower` replaces 0.20's
  reflective `CompositeTypeWrapper` walk.

### 8.3 The stale vendored JSONRPC copies

`scripts/packages/TestItemControllers/packages/JSONRPC` and
`scripts/packages/JuliaWorkspaces/packages/JSONRPC` are **behind** the JSONRPC submodule — still on
the pre-v3 API:

- `core.jl:189` — `S<:JSON.Serialization` (no `jsoncompat.jl` at all)
- `core.jl:228` — `serialization::JSON.Serialization=JSON.StandardSerialization()`
- `core.jl:619,635,837,851` — `sprint(JSON.show_json, x.serialization, message)`
- `src/interface_def.jl:3,13,16,18` — the `CompositeTypeWrapper` overload
- `src/packagedef.jl:12` — `JSONRPCEndpoint{…, JSON.Serializations.StandardSerialization, ContentLengthFraming}`

These are **not** hand-edited files — they are `git subtree`s refreshed from `julia-vscode/JSONRPC.jl`
tags. Sequencing constraint: **JSONRPC 4.0 must be tagged and released before the TestItemControllers /
JuliaWorkspaces subtree pulls**, and those pulls bring the new `jsonx.jl` along automatically. If a
subtree is pulled while still on 0.20-era JSONRPC but the `packages/JSON` subtree has been deleted,
it breaks immediately — so **delete the `JSON` subtree and pull JSONRPC in the same commit**.

### 8.4 Smaller risks, in decreasing likelihood of biting

1. **`IJuliaCore/src/display.jl:94`'s unqualified `JSONText`** (§4.4) — load-time `UndefVarError`,
   because JSONX exports nothing.
2. **`TestrunResult` key-name drift** (§4.3) — the hand-written `_lower` must exactly mirror the
   hand-written reader, or cross-version CI result merging silently loses fields.
3. **`_get_label` returning a non-String** (`tableviewer.jl:152-157`, via `DataAPI.colmetadata`) —
   0.20 would reflect a struct into a JSON object; the new `show_value` fallback stringifies it.
   Different, but strictly more sensible, and cells are stringified anyway.
4. **DAP object key order changes** (§4.2) — harmless to JSON consumers, breaks byte-comparison
   golden tests.
5. **`JSONRPC.JSON` binding** — `TestItemControllers/shared/testserver_protocol.jl:4` does
   `import ..JSONRPC.JSON`. Keeping `const JSON = JSONX` inside `module JSONRPC` preserves it.
   Don't remove it casually.
6. **Contributors with existing clones** need submodule deinit / `.git/config` cleanup.

---

## 9. Verification plan

### 9.1 Two things worth doing first, independent of everything else

1. **Land a tableviewer golden test against the *current* 0.20 code.**
   `scripts/packages/VSCodeServer/test/runtests.jl` is ~180 lines and has **no table coverage at
   all**. Construct a fixed table with a dotted column name, a `"` in a column name, a `\n` in a
   cell, a `NaN`, a `1e300`, a `nothing`, a `missing`, a `nothing` label, a `String` label and a
   `Date` column, and assert the exact expected JSON for `print_table`, `print_schema` and
   `print_body`. Then the rewrite is verified against a committed baseline rather than a transcript.
   **This is the highest-value new test in the whole change** — tableviewer has no tests today and
   is the riskiest rewrite.
2. **Send the `@view` → `SubString` patch upstream** to JuliaIO/JSON.jl.

### 9.2 Differential corpus test (before any code moves)

A throwaway script (not committed) that, against a checkout with both `scripts/packages/JSON` (0.20)
and the patched `jsonx.jl` loaded side by side, asserts `JSON020.json(v) == JSONX.json(_to_plain(v))`
over:

- **A captured real corpus.** Instrument `JSONRPC._serialize_json` and `_parse_json` (a two-line
  `write(logfile, message_json)` behind an env var), then drive a real VS Code session: open a Julia
  project, edit files (many `didChange`), trigger completions / hover / goto-definition / rename /
  formatting, run a debug session, run test items, `vscodedisplay` a DataFrame. Save every frame,
  then assert byte-equality of serializer output for the parsed round-trip of each.
- **The synthetic edge corpus** from §3.2, plus `Int128`, `BigInt`, `BigFloat`, `Float32`, `-0.0`,
  `1e20`, `1e-7`, `2^53±1`, `typemax(Int64)`, DEL, `\x1f`, `"`, `\`, `/`, newline, tab, `é`, `😀`,
  empty string, `nothing`, `missing`, `Symbol`, `Char`, `Enum`, `Date`/`DateTime`/`Time`, a `Type`,
  a `Matrix`, a `Set`, a `NamedTuple`, kwargs `Base.Pairs`, a nested `Outbound` with `missing`
  fields, a `JSONText` at three nesting depths, and a deeply-nested 50-level structure.
- **Parse round-trips** for every string in both corpora:
  `JSONX.parse(s) == JSON020.parse(s; dicttype=Dict{String,Any})`, checking **types** not just
  values (Int64 vs Float64 narrowing).

Run on **1.0.5, 1.5.4, 1.6.7, 1.10, 1.11, 1.12, 1.13** (all present in the local juliaup depot).
1.0 and 1.5 are the ones that matter — they are where `@view` bites and where the
`scripts/packages-old/v1.5` branches are in play. Lone-surrogate and surrogate-pair unescape paths
were only spot-checked on 1.0.5 and 1.13.0 during design; the corpus should cover every version.

Keep a trimmed version of the synthetic half as a committed `JSONRPC/test/test_wire_compat.jl` that
checks JSONX output against hard-coded expected strings, so it survives deleting the 0.20 copy.

### 9.3 Existing suites, in the order to run them locally

```bash
# 1 — fastest, catches _to_plain bugs
julia --project=./scripts/environments/languageserver/v1.13    -e 'using Pkg; Pkg.test("JSONRPC")'
# 2 — the Julia-1.0 canary; an unpatched @view explodes here
julia --project=./scripts/testenvironments/debugadapter/v1.0   -e 'using Pkg; Pkg.test("DebugAdapter")'
# 3 — the include("jsonx.jl") path on 1.0 + the IJuliaCore load
julia --project=./scripts/testenvironments/vscodeserver/v1.0   -e 'using Pkg; Pkg.test("VSCodeServer")'
# 4 — the lower(::URI) / lower(::Range) migration
julia --project=./scripts/environments/languageserver/v1.13    -e 'using Pkg; Pkg.test("LanguageServer")'
# 5 — Results round-trip
julia --project=./scripts/environments/testitemcontroller/v1.13 -e 'using Pkg; Pkg.test("TestItemControllers")'
# 6
npm ci && npm run compile-tests && npm test
```

For reference, from `.github/workflows/main.yml`:

```
# testJuliaPackages (:80-104) — Julia 1.10, 1.13 (+1.0…1.12 at :231)
julia --project=./scripts/testenvironments/debugadapter/v1.13   -e 'using Pkg; Pkg.test("DebugAdapter")'
julia --project=./scripts/testenvironments/vscodedebugger/v1.13 -e 'using Pkg; Pkg.test("VSCodeDebugger")'
julia --project=./scripts/testenvironments/vscodeserver/v1.13   -e 'using Pkg; Pkg.test("VSCodeServer")'

# testJuliaLSPackages (:106-129) — Julia 1.13 (+1.11, 1.12 at :257)
julia --project=./scripts/environments/languageserver/v1.13 -e 'using Pkg; Pkg.resolve()'
#   then Pkg.test for JSONRPC, LanguageServer, JuliaWorkspaces, CSTParser, TestItemDetection

# testExtension (:55-78) — Julia 1.13 on ubuntu/windows/macos
npm ci && npm run compile-tests && npm test   # xvfb-run -a npm test on Linux
```

Note `Pkg.test("TestItemControllers")` is **not** currently run by `main.yml`, but it exercises
`Results.write_json`/`read_json` and the full JSON-RPC controller round trip
(`test/test_jsonrpc_controller.jl`, `test/test_shutdown.jl`).

### 9.4 Manual end-to-end

`npm test` drives the TS side, not the Julia processes. A manual pass covering all five
include-sites, on the oldest **and** newest supported Julia (the two ends of the `packages-old`
branching):

- **VSCodeServer** — `vscodedisplay(DataFrame(…))` for a small table (sync path, `print_table`), a
  200 000-row table (async path: `print_schema` + `JSONText` splice + `get_table_data_request`
  paging), scroll/sort/filter it; `@vscodedisplay` a Plots figure (the `IJuliaCore.display_dict` /
  `JSONText` path — **where the `display.jl:94` bug would surface**); workspace/variable explorer;
  click a `vscode_cmd_uri` link (`misc.jl:197`).
- **LanguageServer** — open a package, edit, completion, hover, goto-def, rename (the
  `WorkspaceEdit`/`TextDocumentEdit` path), format, diagnostics appear and clear.
- **VSCodeDebugger / DebugAdapter** — `@enter`, breakpoints, variables pane (deep `Outbound`
  nesting with `missing` fields), step, watch expressions.
- **TestItemControllers + TestItemServer** — run test items from the Test Explorer including a
  failing one (the `TestMessage`/`Location`/`Range` path, exactly where
  `testserver_protocol.jl:20`'s `lower(::Range)` lives), and a run that writes a results file.
- **JuliaWorkspaces dynamic analysis** — whatever triggers `juliadynamicanalysisprocess`.

---

## 10. Multi-repo rollout

Five repos, in an order forced by the subtree/submodule graph:

```
JSONRPC.jl  ──subtree──▶ JuliaWorkspaces.jl ──┐
    │                                          ├──submodule──▶ julia-vscode
    └────────subtree──▶ TestItemControllers.jl ┘
DebugAdapter.jl ──────────submodule───────────▶ julia-vscode
LanguageServer.jl ────────submodule───────────▶ julia-vscode
```

1. **JSONRPC.jl** — vendor + patch `src/jsonx.jl`, add `src/lower.jl`, rewrite `jsoncompat.jl`,
   strip the endpoint type parameter, migrate the tests, delete `juliaci-oldjson.yml` and `.ci/*`,
   CHANGELOG, tag **v4.0.0**. The only repo where the differential corpus test must pass before
   anything else moves.
2. **DebugAdapter.jl** — independent of (1). Vendor its own `src/DAPRPC/jsonx.jl` + local
   `lower`/`_to_plain`, rewrite `interface_def.jl` and the five `core.jl` call sites, drop the
   `JSON` dep, tag a major.
3. **LanguageServer.jl** — needs JSONRPC v4 registered. Two one-line `JSON.lower` → `JSONRPC.lower`
   edits, drop the `JSON` dep, bump `JSONRPC = "4"`, tag.
4. **JuliaWorkspaces.jl** — `scripts/update_vendored_packages.jl` pull of JSONRPC v4 **and**
   `git rm -r packages/JSON` in the *same commit*; update
   `juliadynamicanalysisprocess/…/pkg_imports.jl:1`; delete the "we skip this" comment at line 14; tag.
5. **TestItemControllers.jl** — same subtree operation (`scripts/update_vendored_packages.jl:15`),
   plus `src/TestItemControllers.jl:7`, `testprocess/TestItemServer/src/pkg_imports.jl:3`,
   `src/results.jl:204` (the `_lower` schema), `shared/testserver_protocol.jl:4,20`; tag.
6. **julia-vscode** — bump the five submodules; `git rm scripts/packages/JSON` + `.gitmodules`;
   `VSCodeServer.jl:13` and `VSCodeDebugger.jl:8`; the `tableviewer.jl` rewrite + `compactjson.jl`;
   `IJuliaCore/src/display.jl:94`; the environment `Project.toml` edits and `create_*_project.jl`
   edits; regenerate every manifest via the `updateDeps` tooling; run the full matrix.

**The awkward part:** steps 1–5 each need a **registry release** before the next consumer can
resolve them, and step 6's manifests can only be regenerated once all five are tagged.

**Mitigation:** do the work on branches and use `[sources]`/`Pkg.develop` against local checkouts to
run the whole thing end-to-end *before* any tagging. The `scripts/environments/*/[sources]` blocks
already point at the submodule paths, so **a julia-vscode branch with all five submodules on feature
branches is a complete, testable system** — that is the right place to prove the design before any
release is cut.

---

## Appendix: reference facts gathered

**Upstream JSON.jl v1.8 `Project.toml`** — deps `Dates`, `Logging`, `Parsers`, `PrecompileTools`,
`StructUtils`, `UUIDs`, `Unicode`; `julia = "1.10"`. `src/JSON.jl:8` does
`import StructUtils: …, lower, lift`, so `JSON.lower` exists; `JSON.parse(x; dicttype=…)` is
supported (`src/parse.jl:19,258`); `JSONText` is exported.

**`scripts/packages/JSON` (v0.20.1)** — `src/` is ~1138 lines across `JSON.jl`, `Common.jl`,
`Parser.jl` (444), `Serializations.jl`, `Writer.jl` (357), `specialized.jl`, `bytes.jl`,
`pushvector.jl`, `errors.jl`. Submodule pinned at `4b3913d58f04cc5bb2f8d23c6ef82e0fbed20525`
(tag `v0.20.1`). Its `.git` file still points at the legacy path
`../../../.git/modules/scripts/languageserver/packages/JSON` — a leftover from commit `06345967`.

**Current JSON compat declarations**

| file | compat |
|---|---|
| `scripts/packages/JSONRPC/Project.toml` | `"0.20, 0.21, 1"` (already JSON-1-ready) |
| `scripts/packages/LanguageServer/Project.toml` | `"0.20, 0.21, 1"` |
| `scripts/packages/DebugAdapter/Project.toml` | `"0.20, 0.21"` |
| `scripts/packages/IJuliaCore/Project.toml` | `"0.18,0.19,0.20,0.21,1"` |
| `.../TestItemControllers/packages/JSONRPC/Project.toml` | `"0.20, 0.21"` (stale copy) |
| `.../JuliaWorkspaces/packages/JSONRPC/Project.toml` | `"0.20, 0.21"` (stale copy) |

**Julia version floors**

| component | minimum | source |
|---|---|---|
| REPL / `VSCodeServer` | 1.0 | `scripts/environments/terminalserver/v1.0/`; `julia = "1"` |
| Debugger / `VSCodeDebugger` / `DebugAdapter` | 1.0 | `scripts/testenvironments/debugadapter/v1.0/` |
| Language server | 1.11 | `scripts/languageserver/main.jl:1-3` |
| Test item controller | 1.12 | `scripts/apps/testitemcontroller_main.jl:1-3` |

**How the load path is set up** — there is no `JULIA_LOAD_PATH`/`JULIA_DEPOT_PATH` manipulation on
the TypeScript side; environment selection happens inside the Julia entry scripts.

| component | entry script | mechanism |
|---|---|---|
| Language server | `scripts/languageserver/main.jl:7-13` | `Pkg.activate` `scripts/environments/languageserver/v$MAJOR.$MINOR/` else `fallback/` |
| Test item controller | `scripts/apps/testitemcontroller_main.jl:7-13` | same shape under `testitemcontroller/` |
| REPL / notebook | `scripts/terminalserver/load_vscodeserver.jl` | temporarily swaps `Base.ACTIVE_PROJECT[]`, loads `VSCodeServer`, restores the user's project (also propagates to `Distributed` workers) |
| Debugger | `scripts/debugger/run_debugger.jl:3-8` | `pushfirst!(LOAD_PATH, joinpath(@__DIR__, "..", "packages"))` |
| Test task | `scripts/tasks/task_test.jl:10-12` | `empty!(Base.LOAD_PATH)` then push `packages` + `@stdlib` |
