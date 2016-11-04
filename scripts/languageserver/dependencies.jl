function use_and_install_dependencies(deps)
    lock_aquired = false
    while !lock_aquired
        try
            if is_windows()
                global_lock_socket_name = "\\\\.\\pipe\\vscode-language-server-global-lock"
            elseif is_unix()
                global_lock_socket_name = joinpath(tempdir(), "vscode-language-server-global-lock")
            else
                error("Unknown operating system")
            end
            socket = listen(global_lock_socket_name)
            try
                for (dep,version) in deps
                    try
                        eval(parse("using $dep"))
                    catch
                        Pkg.init()
                        Pkg.add(dep, version)
                        eval(parse("using $dep"))
                    end
                end
            finally
                close(socket)
                lock_aquired = true
            end
        catch e
            info("Another julia language server process is currently updating packages, trying again in 1 second.")
            sleep(1.)
        end
    end
end
