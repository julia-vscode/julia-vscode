if VERSION < v"1.0.0"
    error("VS Code julia language server only works with julia 1.0.0+")
end

try
    if length(Base.ARGS) != 4
        error("Invalid number of arguments passed to julia language server.")
    end

    conn = stdout
    (outRead, outWrite) = redirect_stdout()

    if Base.ARGS[2] == "--debug=no"
        const global ls_debug_mode = false
    elseif Base.ARGS[2] == "--debug=yes"
        const global ls_debug_mode = true
    end

    using LanguageServer, Sockets, SymbolServer

    server = LanguageServerInstance(stdin, conn, ls_debug_mode, Base.ARGS[1], Base.ARGS[4], Dict())
    run(server)
catch e
    @info "Language Server crashed with"
    @info e
    using Sockets
    st = stacktrace(catch_backtrace())
    vscode_pipe_name = Base.ARGS[3]
    pipe_to_vscode = connect(vscode_pipe_name)
    try
        # Send error type as one line
        println(pipe_to_vscode, typeof(e))

        # Send error message
        temp_io = IOBuffer()
        showerror(temp_io, e)
        error_message_str = chomp(String(take!(temp_io)))
        n = count(i->i=='\n', error_message_str) + 1
        println(pipe_to_vscode, n)
        println(pipe_to_vscode, error_message_str)

        # Send stack trace, one frame per line
        # Note that stack frames need to be formatted in Node.js style
        for s in st
            print(pipe_to_vscode, " at ")
            Base.StackTraces.show_spec_linfo(pipe_to_vscode, s)

            filename = string(s.file)

            # Now we need to sanitize the filename so that we don't transmit
            # things like a username in the path name
            filename = normpath(filename)
            if isabspath(filename)
                root_path_of_extension = normpath(joinpath(@__DIR__, "..", ".."))
                if startswith(filename, root_path_of_extension)
                    filename = joinpath(".", filename[lastindex(root_path_of_extension)+1:end])
                else
                    filename = basename(filename)
                end
            else
                filename = basename(filename)
            end

            # Use a line number of "0" as a proxy for unknown line number
            print(pipe_to_vscode, " (", filename, ":", s.line >= 0 ? s.line : "0", ":1)" )

            # TODO Unclear how we can fit this into the Node.js format
            # if s.inlined
            #     print(pipe_to_vscode, " [inlined]")
            # end

            println(pipe_to_vscode)
        end
    finally
        close(pipe_to_vscode)
    end
    rethrow()
end
