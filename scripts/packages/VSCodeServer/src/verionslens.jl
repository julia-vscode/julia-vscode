JSONRPC.@dict_readable struct LensParams <: JSONRPC.Outbound
    name::String
end


const lens_request_type = JSONRPC.RequestType("lens", LensParams, Bool)

function lens_request(conn, params::LensParams)
    println(params.name)
    return true
end
