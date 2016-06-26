if VERSION < v"0.4" || VERSION >= v"0.5-"
    println("VS Code linter only works with julia 0.4")
else
    try
        eval(parse("using Lint"))
    catch e
        println("Installing Lint package")
        Pkg.init()
        Pkg.add("Compat", v"0.8.4")
        Pkg.add("Lint", v"0.2.3")
        eval(parse("using Lint"))
    end

    if length(Base.ARGS)!=2
        error()
    end

    push!(LOAD_PATH, Base.ARGS[2])

    lintserver(Base.ARGS[1])
end
