JSONRPC.@dict_readable struct NotebookRunCellArguments <: JSONRPC.Outbound
    filename::String
    line::Int
    column::Int
    code::String
end

const notebook_runcell_request_type = JSONRPC.RequestType("notebook/runcell", NotebookRunCellArguments, NamedTuple{(:success, :error),Tuple{Bool,NamedTuple{(:message, :name, :stack),Tuple{String,String,String}}}})

function notebook_runcell_request(conn, params::NotebookRunCellArguments)
    try
        code = string('\n'^params.line, ' '^params.column, params.code)

        withpath(params.filename) do
            revise()

            args = VERSION >= v"1.5" ? (REPL.softscope, Main, code, params.filename) : (Main, code, params.filename)
            result = Base.invokelatest(include_string, args...)

            IJuliaCore.flush_all()

            if result !== nothing && !ends_with_semicolon(code)
                Base.invokelatest(Base.display, result)
            end

            IJuliaCore.flush_all()

            return (success = true, error = (message = "", name = "", stack = ""))
        end
    catch err
        bt = catch_backtrace()

        if err isa LoadError
            inner_err = err.error

            st = stacktrace(bt)

            error_type = string(typeof(inner_err))
            error_message_str = sprint(showerror, inner_err)
            traceback = sprint(Base.show_backtrace, bt)

            return (success = false, error = (message = error_message_str, name = error_type, stack = traceback))
        else
            rethrow(err)
            error("Not clear what this means, but we should probably send a crash report.")
        end
    end
end

function io_send_callback(name, data)
    JSONRPC.send_notification(conn_endpoint[], "streamoutput", Dict{String,Any}("name" => name, "data" => data))
end

function serve_notebook(pipename; crashreporting_pipename::Union{AbstractString,Nothing}=nothing)
    conn = Sockets.connect(pipename)

    conn_endpoint[] = JSONRPC.JSONRPCEndpoint(conn, conn)

    run(conn_endpoint[])

    IJuliaCore.orig_stdin[]  = Base.stdin
    IJuliaCore.orig_stdout[] = Base.stdout
    IJuliaCore.orig_stderr[] = Base.stderr

    try
        if IJuliaCore.capture_stdout
            IJuliaCore.read_stdout[], = Base.redirect_stdout()
            redirect_stdout(IJuliaCore.IJuliaStdio(Base.stdout, io_send_callback, "stdout"))
        end
        if IJuliaCore.capture_stderr
            IJuliaCore.read_stderr[], = redirect_stderr()
            redirect_stderr(IJuliaCore.IJuliaStdio(Base.stderr, io_send_callback, "stderr"))
        end
        redirect_stdin(IJuliaCore.IJuliaStdio(Base.stdin, io_send_callback, "stdin"))

        logger = Base.CoreLogging.SimpleLogger(Base.stderr)
        Base.CoreLogging.global_logger(logger)

        Base.Multimedia.pushdisplay(JuliaNotebookInlineDisplay())

        IJuliaCore.watch_stdio(io_send_callback)

        msg_dispatcher = JSONRPC.MsgDispatcher()
        msg_dispatcher[notebook_runcell_request_type] = notebook_runcell_request
        msg_dispatcher[repl_getvariables_request_type] = repl_getvariables_request
        msg_dispatcher[repl_getlazy_request_type] = repl_getlazy_request
        msg_dispatcher[repl_showingrid_notification_type] = repl_showingrid_notification

        println(IJuliaCore.orig_stdout[], "Julia Kernel started...")

        while true
            msg = JSONRPC.get_next_message(conn_endpoint[])

            JSONRPC.dispatch_msg(conn_endpoint[], msg_dispatcher, msg)
        end

    catch err
        bt = catch_backtrace()
        Base.display_error(IJuliaCore.orig_stderr[], err, bt)
        try
            global_err_handler(err, bt, crashreporting_pipename, "Notebook")
        catch err
            @error "Error handler threw an error." exception = (err, bt)
        end

    end

end
