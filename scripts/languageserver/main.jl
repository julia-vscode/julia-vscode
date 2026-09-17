if VERSION < v"1.11.0"
    error("The Julia language server only works with Julia 1.11.0 or newer")
end

@info "Starting LS with Julia $VERSION"

import Pkg
version_specific_env_path = joinpath(@__DIR__, "..", "environments", "languageserver", "v$(VERSION.major).$(VERSION.minor)")
if isdir(version_specific_env_path)
    Pkg.activate(version_specific_env_path)
else
    Pkg.activate(joinpath(@__DIR__, "..", "environments", "languageserver", "fallback"))
end

@debug "Julia started at $(round(Int, time()))"

using Logging, LoggingExtras
global_logger(ConsoleLogger(stderr))

@info "Starting the Julia Language Server"

using InteractiveUtils, Sockets

include("../error_handler.jl")
# START DIAG MOD

# is_disconnected_exception(err) = false
# is_disconnected_exception(err::InvalidStateException) = err.state === :closed
# is_disconnected_exception(err::Base.IOError) = true
# is_disconnected_exception(err::CompositeException) = all(is_disconnected_exception, err.exceptions)

# function global_err_handler(e, bt, vscode_pipe_name, cloudRole)
#     if is_disconnected_exception(e)
#         @debug "Disconnect. Nothing to worry about."
#         return
#     end

#     @error "Some Julia code in the VS Code extension crashed"
#     Base.display_error(e, bt)


#     try
#         st = stacktrace(bt)
#         pipe_to_vscode = connect(vscode_pipe_name)
#         try
#             # Send cloudRole as one line
#             println(pipe_to_vscode, cloudRole)
#             # Send error type as one line
#             println(pipe_to_vscode, typeof(e))

#             # Send error message
#             temp_io = IOBuffer()
#             showerror(temp_io, e)
#             println(temp_io)
#             println(temp_io)
#             InteractiveUtils.versioninfo(temp_io, verbose=false)
#             println(temp_io)
#             println(temp_io)
#             println(temp_io, join(LanguageServer.TEMPDEBUG[], "\n"))

#             error_message_str = chomp(String(take!(temp_io)))
#             n = count(i -> i == '\n', error_message_str) + 1
#             println(pipe_to_vscode, n)
#             println(pipe_to_vscode, error_message_str)

#             # Send stack trace, one frame per line
#             # Note that stack frames need to be formatted in Node.js style
#             for s in st
#                 print(pipe_to_vscode, " at ")
#                 Base.StackTraces.show_spec_linfo(pipe_to_vscode, s)

#                 filename = string(s.file)

#                 # Now we need to sanitize the filename so that we don't transmit
#                 # things like a username in the path name
#                 filename = normpath(filename)
#                 if isabspath(filename)
#                     root_path_of_extension = normpath(joinpath(@__DIR__, "..", ".."))
#                     if startswith(filename, root_path_of_extension)
#                         filename = joinpath(".", filename[lastindex(root_path_of_extension) + 1:end])
#                     else
#                         filename = basename(filename)
#                     end
#                 else
#                     filename = basename(filename)
#                 end

#                 # Use a line number of "0" as a proxy for unknown line number
#                 print(pipe_to_vscode, " (", filename, ":", s.line >= 0 ? s.line : "0", ":1)")

#                 # TODO Unclear how we can fit this into the Node.js format
#                 # if s.inlined
#                 #     print(pipe_to_vscode, " [inlined]")
#                 # end

#                 println(pipe_to_vscode)
#             end
#         finally
#             close(pipe_to_vscode)
#         end
#     finally
#         exit(1)
#     end
# end

# END DIAG MOD

struct LSPrecompileFailure <: Exception
    msg::AbstractString
end

function Base.showerror(io::IO, ex::LSPrecompileFailure)
    print(io, ex.msg)
end

include(joinpath(@__DIR__, "..", "precompile_failures.jl"))

"""
Describes the shape of the storage path the extension passed in `ARGS[4]`, and
of the symbol store path derived from it, without disclosing either: crash
reports leave the user's machine, so only derived facts are transmitted.

Telemetry shows `mkpath` failing on a path with a single leading separator where
a UNC path would have had two, and no report so far can explain where such a
value came from. `leading separators` is the field that tells a path which
arrived malformed apart from a well-formed one that Julia then mishandled.
"""
function storage_path_diagnostics(storage_path::AbstractString, store_path::AbstractString)
    is_separator(c) = c === '/' || c === '\\'

    function leading_separators(p)
        n = 0
        for c in p
            is_separator(c) || break
            n += 1
        end
        return n
    end

    function drive_kind(p)
        drive, _ = splitdrive(p)
        if isempty(drive)
            "none"
        elseif length(drive) >= 2 && is_separator(drive[1]) && is_separator(drive[2])
            "unc"
        else
            "letter"
        end
    end

    # A path on an unreachable network location can fail rather than answer, and
    # a diagnostic must never be the thing that throws.
    probe(f, p) = try
        f(p)
    catch
        missing
    end

    io = IOBuffer()
    println(io, "Storage path diagnostics (the paths themselves are not reported):")
    println(io, "  length:                   ", length(storage_path))
    println(io, "  leading separators:       ", leading_separators(storage_path))
    println(io, "  drive kind:               ", drive_kind(storage_path))
    println(io, "  isabspath:                ", probe(isabspath, storage_path))
    println(io, "  path components:          ", probe(p -> length(splitpath(p)), storage_path))
    println(io, "  ispath:                   ", probe(ispath, storage_path))
    println(io, "  isdir:                    ", probe(isdir, storage_path))
    println(io, "  parent isdir:             ", probe(p -> isdir(dirname(p)), storage_path))
    println(io, "  last component is ext id: ", basename(storage_path) == "julialang.language-julia")
    println(io, "  store path ispath:        ", probe(ispath, store_path))
    println(io, "  store path parent isdir:  ", probe(p -> isdir(dirname(p)), store_path))
    println(io, "  homedir drive kind:       ", probe(drive_kind, homedir()))
    println(io, "  kernel:                   ", Sys.KERNEL)
    print(io,   "  iswindows:                ", Sys.iswindows())
    return String(take!(io))
end

"""
Wraps an error thrown while creating the symbol store directory, so that the
crash report carries `storage_path_diagnostics` alongside the original error.

The language server still dies exactly as it did before; only the report is
richer. `showerror` delegates to the wrapped error first, so the message still
opens with the text the report used to carry.
"""
struct LSStorePathError <: Exception
    err::Exception
    diagnostics::String
end

function Base.showerror(io::IO, ex::LSStorePathError)
    showerror(io, ex.err)
    print(io, "\n\n", ex.diagnostics)
end

try
    if length(Base.ARGS) != 7
        error("Invalid number of arguments passed to julia language server.")
    end

    debug_mode = if Base.ARGS[2] == "--debug=yes"
        true
    elseif Base.ARGS[2] == "--debug=no"
        false
    else
        error("Invalid argument passed.")
    end

    detached_mode = if Base.ARGS[5] == "--detached=yes"
        true
    elseif Base.ARGS[5] == "--detached=no"
        false
    else
        error("Invalid argument passed.")
    end

    if debug_mode
        global_logger(EarlyFilteredLogger(ConsoleLogger(stderr, Logging.Debug)) do log
            nameof(log._module) in (:Main,:CancellationTokens,:CSTParser,:JuliaFormatter,:JSONRPC,:JuliaSyntax,:JuliaWorkspaces,:LanguageServer,:Salsa,:TestItemDetection)
        end)
    end

    if detached_mode
        port = 7777
        @info "listening on $port"
        serv = listen(port)
        global conn_in = accept(serv)
        global conn_out = conn_in
        @info "connection accepted"
    else
        global conn_in = stdin
        global conn_out = stdout
        (outRead, outWrite) = redirect_stdout()
    end


    try
        using LanguageServer
    catch err
        if is_precompile_failure(err)
            # The extension does not set JULIA_DEPOT_PATH when spawning the LS
            # (a user can via julia.additionalEnvironmentVariables), so fall
            # back to the effective depot path rather than crashing with a
            # KeyError that masks the precompile failure being reported.
            depot_path = get(ENV, "JULIA_DEPOT_PATH", join(DEPOT_PATH, Sys.iswindows() ? ';' : ':'))
            println(stderr, """\n
            The Language Server failed to precompile.
            Please make sure you have permissions to write to the LS depot path at
            \t$(depot_path)
            """)
            throw(LSPrecompileFailure(sprint(showerror, err)))
        else
            rethrow(err)
        end
    end

    @info "LanguageServer.jl loaded at $(round(Int, time()))"

    store_version = isdefined(LanguageServer, :JuliaWorkspaces) &&
        isdefined(LanguageServer.JuliaWorkspaces, :SymbolServer) &&
        isdefined(LanguageServer.JuliaWorkspaces.SymbolServer, :CACHE_STORE_VERSION) ?
            LanguageServer.JuliaWorkspaces.SymbolServer.CACHE_STORE_VERSION :
            "v0"
    symserver_store_path = joinpath(ARGS[4], "symbolstore", store_version)

    if !ispath(symserver_store_path)
        try
            mkpath(symserver_store_path)
        catch err
            (err isa Base.IOError || err isa Base.SystemError) || rethrow()
            diagnostics = try
                storage_path_diagnostics(ARGS[4], symserver_store_path)
            catch diagnostics_err
                "Storage path diagnostics could not be collected: " *
                    sprint(showerror, diagnostics_err)
            end
            throw(LSStorePathError(err, diagnostics))
        end
    end

    @info "Symbol server store is at '$symserver_store_path'."

    server = LanguageServerInstance(
        conn_in,
        conn_out,
        Base.ARGS[1],
        (err, bt) -> global_err_handler(err, bt, Base.ARGS[3], "Language Server"),
        symserver_store_path,
        (path=Base.ARGS[6], version=VersionNumber(ARGS[7]))
    )
    @info "Starting LS at $(round(Int, time()))"
    run(server)
catch err
    global_err_handler(err, catch_backtrace(), Base.ARGS[3], "Language Server")
end
