using Pkg

julia_interpreter_path = if VERSION >= v"1.10.0"
    "../../../packages/JuliaInterpreter"
elseif VERSION >= v"1.6.0"
    "../../../packages-old/v1.9/JuliaInterpreter"
else
    "../../../packages-old/v1.5/JuliaInterpreter"
end

code_tracking_path = if VERSION >= v"1.10.0"
    "../../../packages/CodeTracking"
elseif VERSION >= v"1.7.0"
    "../../../packages-old/v1.7/CodeTracking"
else
    "../../../packages-old/v1.5/CodeTracking"
end

Pkg.develop([
    PackageSpec(path=code_tracking_path),
    PackageSpec(path="../../../packages/DebugAdapter"),
    PackageSpec(path="../../../packages/JSON"),
    PackageSpec(path="../../../packages/CancellationTokens"),
    PackageSpec(path="../../../packages/JSONRPC"),
    PackageSpec(path=julia_interpreter_path),
])
