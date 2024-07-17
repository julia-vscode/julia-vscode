if VERSION < v"1.6.0"
    error("VS Code julia language server only works with julia 1.6.0 or newer")
end

import Pkg
version_specific_env_path = joinpath(@__DIR__, "..", "environments", "languageserver", "v$(VERSION.major).$(VERSION.minor)")
if isdir(version_specific_env_path)
    Pkg.activate(version_specific_env_path)
else
    Pkg.activate(joinpath(@__DIR__, "..", "environments", "languageserver", "fallback"))
end

@debug "Julia started at $(round(Int, time()))"

using Logging
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

try
    if length(Base.ARGS) != 10
        error("Invalid number of arguments passed to julia language server.")
    end

    debug_mode = if Base.ARGS[2] == "--debug=yes"
        true
    elseif Base.ARGS[2] == "--debug=no"
        false
    else
        error("Invalid argument passed.")
    end

    detached_mode = if Base.ARGS[8] == "--detached=yes"
        true
    elseif Base.ARGS[8] == "--detached=no"
        false
    else
        error("Invalid argument passed.")
    end

    if debug_mode
        ENV["JULIA_DEBUG"] = "all"
    end

    if detached_mode
        serv = listen(7777)
        global conn_in = accept(serv)
        global conn_out = conn_in
    else
        global conn_in = stdin
        global conn_out = stdout
        (outRead, outWrite) = redirect_stdout()
    end


    try
        using LanguageServer, SymbolServer
    catch err
        if err isa ErrorException && startswith(err.msg, "Failed to precompile")
            println(stderr, """\n
            The Language Server failed to precompile.
            Please make sure you have permissions to write to the LS depot path at
            \t$(ENV["JULIA_DEPOT_PATH"])
            """)
            throw(LSPrecompileFailure(err.msg))
        else
            rethrow(err)
        end
    end

    @debug "LanguageServer.jl loaded at $(round(Int, time()))"

    symserver_store_path = joinpath(ARGS[5], "symbolstorev5")

    if !ispath(symserver_store_path)
        mkpath(symserver_store_path)
    end

    @info "Symbol server store is at '$symserver_store_path'."

    server = LanguageServerInstance(
        conn_in,
        conn_out,
        Base.ARGS[1],
        Base.ARGS[4],
        (err, bt) -> global_err_handler(err, bt, Base.ARGS[3], "Language Server"),
        symserver_store_path,
        ARGS[6] == "download",
        Base.ARGS[7],
        (path=Base.ARGS[9], version=VersionNumber(ARGS[10]))
    )
    @info "Starting LS at $(round(Int, time()))"
    run(server)
catch err
    global_err_handler(err, catch_backtrace(), Base.ARGS[3], "Language Server")
end
