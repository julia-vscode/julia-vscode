@info "Starting the Julia Test Server"

import Pkg
version_specific_env_path = joinpath(@__DIR__, "environments", "v$(VERSION.major).$(VERSION.minor)")
if isdir(version_specific_env_path)
    Pkg.activate(version_specific_env_path, io=devnull)
else
    Pkg.activate(joinpath(@__DIR__, "environments", "fallback"), io=devnull)
end

using TestItemServer

TestItemServer.serve(ARGS[1], ARGS[2])
