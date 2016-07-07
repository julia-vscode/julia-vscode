if VERSION < v"0.4" || VERSION >= v"0.5-"
    println("VS Code linter only works with julia 0.4")
else
    lock_aquired = false
    while !lock_aquired
        try
            @windows_only global_lock_socket_name = "\\\\.\\pipe\\vscode-language-lint-server-global-lock"
            @unix_only global_lock_socket_name = joinpath(tempdir(), "vscode-language-lint-server-global-lock")
            socket = listen(global_lock_socket_name)
            try
                try
                    eval(parse("using Lint"))
                catch e
                    println("Installing Lint package")
                    Pkg.init()
                    Pkg.add("Compat", v"0.8.4")
                    Pkg.add("Lint", v"0.2.3")
                    eval(parse("using Lint"))
                end
            finally
                close(socket)
                lock_aquired = true
            end
        catch e
            info("Another julia lint process is currently updating packages, trying again in 1 second.")
            sleep(1.)
        end
    end

    if length(Base.ARGS)!=2
        error()
    end

    push!(LOAD_PATH, Base.ARGS[2])

    lintserver(Base.ARGS[1])
end
