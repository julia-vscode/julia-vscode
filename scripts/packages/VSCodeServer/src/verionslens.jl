include("../../RegistryQuery/RegistryQuery.jl")


JSONRPC.@dict_readable struct LensParams <: JSONRPC.Outbound
    name::String
    uuid::String
end

const lens_request_type = JSONRPC.RequestType("lens", LensParams, Bool)

regiestries = RegistryQuery.reachable_registries()
function lens_request(conn, params::LensParams)
    vs = RegistryQuery.get_available_versions(regiestries[1], params.uuid)
    println(vs)

    return true
end
