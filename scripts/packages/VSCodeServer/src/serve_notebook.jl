JSONRPC.@dict_readable struct NotebookRunCellArguments <: JSONRPC.Outbound
    filename::String
    line::Int
    column::Int
    code::String
end

const notebook_runcell_request_type = JSONRPC.RequestType("notebook/runcell", NotebookRunCellArguments, NamedTuple{(:success, :error),Tuple{Bool,NamedTuple{(:message, :name, :stack),Tuple{String,String,String}}}})

function notebook_runcell_request(conn, params::NotebookRunCellArguments)
    code = string('\n'^params.line, ' '^params.column, params.code)

    withpath(params.filename) do
        revise()

        args = VERSION >= v"1.5" ? (REPL.softscope, Main, code, params.filename) : (Main, code, params.filename)

        result = try
            if isready(DEBUG_SESSION[])
                debug_session = fetch(DEBUG_SESSION[])

                DebugAdapter.debug_code(debug_session, code, params.filename)
            else
                Base.invokelatest(include_string, args...)
            end
        catch err
            bt = crop_backtrace(catch_backtrace())

            if err isa LoadError
                inner_err = err.error
                error_type = string(typeof(inner_err))

                try
                    error_message_str = Base.invokelatest(sprint, showerror, inner_err)
                    traceback = Base.invokelatest(sprint, Base.show_backtrace, bt)

                    flush(stdout)
                    flush(stderr)

                    return (success = false, error = (message = error_message_str, name = error_type, stack = string(error_message_str, "\n", traceback)))
                catch err
                    return (success = false, error = (message = "Error trying to display an error.", name = error_type, stack = "Error trying to display an error."))
                end
            else
                rethrow(err)
                error("Not clear what this means, but we should probably send a crash report.")
            end
        end

        IJuliaCore.flush_all()

        if result !== nothing && !ends_with_semicolon(code)
            try
                Base.invokelatest(Base.display, result)
            catch err
                error_type = string(typeof(err))

                try
                    bt = crop_backtrace(catch_backtrace())

                    error_message_str = Base.invokelatest(sprint, showerror, err)
                    traceback = Base.invokelatest(sprint, Base.show_backtrace, bt)

                    return (success=false, error=(message=error_message_str, name=error_type, stack=string(error_message_str, "\n", traceback)))
                catch err
                    return (success=false, error=(message="Error trying to display an error.", name=error_type, stack="Error trying to display an error."))
                end
            end
        end

        IJuliaCore.flush_all()

        return (success = true, error = (message = "", name = "", stack = ""))
    end
end

function io_send_callback(name, data)
    JSONRPC.send_notification(conn_endpoint[], "streamoutput", Dict{String,Any}("name" => name, "data" => data))
end

function serve_notebook(pipename, debugger_pipename, outputchannel_logger; crashreporting_pipename::Union{AbstractString,Nothing}=nothing)
    Base.with_logger(outputchannel_logger) do
        @info "Trying to connect..."
    end
    conn = Sockets.connect(pipename)

    Base.with_logger(outputchannel_logger) do
        @info "Connection established"
    end

    conn_endpoint[] = JSONRPC.JSONRPCEndpoint(conn, conn)

    Base.with_logger(outputchannel_logger) do
        @info "Starting JSONRPC endpoint..."
    end

    start_debug_backend(debugger_pipename)

    run(conn_endpoint[])

    Base.with_logger(outputchannel_logger) do
        @info "JSONRPC endpoint started"
    end

    IJuliaCore.orig_stdin[] = Base.stdin
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

        Base.with_logger(outputchannel_logger) do
            @info "Creating msg dispather"
        end

        msg_dispatcher = JSONRPC.MsgDispatcher()
        msg_dispatcher[notebook_runcell_request_type] = notebook_runcell_request
        msg_dispatcher[repl_getvariables_request_type] = repl_getvariables_request
        msg_dispatcher[repl_getlazy_request_type] = repl_getlazy_request
        msg_dispatcher[repl_showingrid_notification_type] = repl_showingrid_notification
        msg_dispatcher[repl_gettabledata_request_type] = get_table_data
        msg_dispatcher[repl_clearlazytable_notification_type] = clear_lazy_table

        Base.with_logger(outputchannel_logger) do
            @info "Julia Kernel started"
        end

        while true
            try
                msg = JSONRPC.get_next_message(conn_endpoint[])

                JSONRPC.dispatch_msg(conn_endpoint[], msg_dispatcher, msg)
            catch err
                err isa InterruptException || rethrow()
            end
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
