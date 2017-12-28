try
    if VERSION < v"0.6.0-rc1"
        error("VS Code julia language server only works with julia 0.6 or newer.")
    end

    if length(Base.ARGS) != 3
        error("Invalid number of arguments passed to julia language server.")
    end

    conn = STDOUT
    (outRead, outWrite) = redirect_stdout()

    if Base.ARGS[2] == "--debug=no"
        const global ls_debug_mode = false
    elseif Base.ARGS[2] == "--debug=yes"
        const global ls_debug_mode = true
    end

    push!(LOAD_PATH, joinpath(dirname(@__FILE__), "packages"))
    push!(LOAD_PATH, Base.ARGS[1])

    using Compat
    using JSON
    using URIParser
    using LanguageServer

    server = LanguageServerInstance(STDIN, conn, ls_debug_mode, Base.ARGS[1])
    run(server)
catch e
    st = catch_stacktrace()
    vscode_pipe_name = is_windows() ? "\\\\.\\pipe\\vscode-language-julia-lscrashreports-$(Base.ARGS[3])" : joinpath(tempdir(), "vscode-language-julia-lscrashreports-$(Base.ARGS[3])")
    pipe_to_vscode = connect(vscode_pipe_name)
    try
        # Send error type as one line
        println(pipe_to_vscode, typeof(e))

        # Send error message as one line
        show(pipe_to_vscode, e)        
        println(pipe_to_vscode)

        # Send stack trace, one frame per line
        # Note that stack frames need to be formatted in Node.js style
        for s in st
            print(pipe_to_vscode, " at ")
            Base.StackTraces.show_spec_linfo(pipe_to_vscode, s)

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
