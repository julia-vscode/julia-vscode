include("../../RegistryQuery/RegistryQuery.jl")


JSONRPC.@dict_readable struct LensParams <: JSONRPC.Outbound
    name::String
    uuid::String
end

JSONRPC.@dict_readable struct LensResponse <: JSONRPC.Outbound
    latest_version::String
    url::String
    registry::String
end

regiestries = RegistryQuery.reachable_registries()
function lens_request(conn, params::LensParams)
    uuid = nothing
    try
        uuid = UUID(params.uuid)
    catch
        uuid = RegistryQuery.uuids_from_name(regiestries[1], params.name)[1]
    end

    metadata =  RegistryQuery.get_pkg_metadata(regiestries[1], uuid)
    return LensResponse(metadata.latest_version, metadata.url, metadata.registry)
end

const lens_request_type = JSONRPC.RequestType("lens", LensParams, LensResponse)
