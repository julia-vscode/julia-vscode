using Pkg

julia_interpreter_path = if VERSION >= v"1.10.0"
    "../../../packages/JuliaInterpreter"
elseif VERSION >= v"1.6.0"
    "../../../packages-old/v1.9/JuliaInterpreter"
else
    "../../../packages-old/v1.5/JuliaInterpreter"
end

Pkg.develop([
    PackageSpec(path="../../../packages/CodeTracking"),
    PackageSpec(path="../../../packages/DebugAdapter"),
    PackageSpec(path="../../../packages/JSON"),
    PackageSpec(path="../../../packages/JSONRPC"),
    PackageSpec(path=julia_interpreter_path),
])
