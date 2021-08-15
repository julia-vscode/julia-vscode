include("../../RegistryQuery/RegistryQuery.jl")


JSONRPC.@dict_readable struct LensParams <: JSONRPC.Outbound
    name::String
    uuid::String
end

JSONRPC.@dict_readable struct LensResponse <: JSONRPC.Outbound
    latest_version::Union{String,Nothing}
    url::Union{String,Nothing}
    registry::String
end

registries = RegistryQuery.reachable_registries()
function lens_request(conn, params::LensParams)
    for registry in registries
        uuid = nothing
        try
            uuid = UUID(params.uuid)
        catch
            uuid = RegistryQuery.uuids_from_name(registry, params.name)[1]
        end

        metadata =  RegistryQuery.get_pkg_metadata(registry, uuid)

        if metadata.latest_version !== nothing
            return LensResponse(metadata.latest_version, metadata.url, metadata.registry)
        end
        return LensResponse(nothing, nothing, "@stdlib")
    end
end

const lens_request_type = JSONRPC.RequestType("lens/pkgVersions", LensParams, LensResponse)
