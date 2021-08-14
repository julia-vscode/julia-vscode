JSONRPC.@dict_readable struct LensParams <: JSONRPC.Outbound
    name::String
    uuid::String
end


const lens_request_type = JSONRPC.RequestType("lens", LensParams, Bool)

function lens_request(conn, params::LensParams)
    printstyled(params.name; color=:cyan, bold=true)
    printstyled(" = \"$(params.uuid)\""; color=:green)
    return true
end
