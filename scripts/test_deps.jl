function get_deps(pkg, deps = Set{String}())
    for d in Pkg.dependents(pkg)
        push!(deps, d)
        get_deps(d, deps)
    end
    return deps
end

function test_dependents(pkg)
    deps = get_deps(pkg)
    for dep in deps
        if Pkg.installed(dep) isa VersionNumber
            Pkg.test(dep)
        end
        
    end
end

println("Testing packages dependent on $(Base.ARGS[1])")
test_dependents(Base.ARGS[1])
