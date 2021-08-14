include("../../RegistryQuery/RegistryQuery.jl")


JSONRPC.@dict_readable struct LensParams <: JSONRPC.Outbound
    name::String
    uuid::String
end

const lens_request_type = JSONRPC.RequestType("lens", LensParams, String)

regiestries = RegistryQuery.reachable_registries()
function lens_request(conn, params::LensParams)
    vs = RegistryQuery.get_available_versions(regiestries[1], params.uuid)
    print("All available versions: ")
    printstyled(vs; color=:blue)

    println()

    print("latest version: ")
    latest_version = RegistryQuery.get_latest_version(regiestries[1], params.uuid)
    printstyled(latest_version; color=:green)

    return latest_version
end
