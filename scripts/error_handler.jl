using Sockets
import InteractiveUtils

is_disconnected_exception(err) = false
is_disconnected_exception(err::InvalidStateException) = err.state === :closed
is_disconnected_exception(err::Base.IOError) = true
is_disconnected_exception(err::CompositeException) = all(is_disconnected_exception, err.exceptions)

function global_err_handler(e, bt, vscode_pipe_name, cloudRole)
    if is_disconnected_exception(e)
        @debug "Disconnect. Nothing to worry about."
        return
    end

    @error "Some Julia code in the VS Code extension crashed"
    Base.display_error(e, bt)
    flush(stdout)
    flush(stderr)


    try
        st = stacktrace(bt)
        pipe_to_vscode = connect(vscode_pipe_name)
        try
            # Send cloudRole as one line
            println(pipe_to_vscode, cloudRole)
            # Send error type as one line
            println(pipe_to_vscode, typeof(e))

            # Send error message
            temp_io = IOBuffer()
            showerror(temp_io, e)
            println(temp_io)
            println(temp_io)
            InteractiveUtils.versioninfo(temp_io, verbose=false)
            error_message_str = chomp(String(take!(temp_io)))
            n = count(i -> i == '\n', error_message_str) + 1
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
                        filename = joinpath(".", filename[lastindex(root_path_of_extension) + 1:end])
                    else
                        filename = basename(filename)
                    end
                else
                    filename = basename(filename)
                end

                # Use a line number of "0" as a proxy for unknown line number
                print(pipe_to_vscode, " (", filename, ":", s.line >= 0 ? s.line : "0", ":1)")

                # TODO Unclear how we can fit this into the Node.js format
                # if s.inlined
                #     print(pipe_to_vscode, " [inlined]")
                # end

                println(pipe_to_vscode)
            end
        finally
            close(pipe_to_vscode)
        end
    finally
        exit(1)
    end
end
