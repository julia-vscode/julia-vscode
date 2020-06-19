JSONRPC.@dict_readable struct ReplGetVariablesRequestReturn <: JSONRPC.Outbound
    type::String
    value::String
    name::String
    id::Int
    haschildren::Bool
    lazy::Bool
    icon::String
    canshow::Bool
end

JSONRPC.@dict_readable struct ReplRunCodeRequestParams <: JSONRPC.Outbound
    filename::String
    line::Int
    column::Int
    code::String
    mod::String
    showCodeInREPL::Bool
    showResultInREPL::Bool
end

JSONRPC.@dict_readable struct ReplRunCodeRequestReturn <: JSONRPC.Outbound
    inline::String
    all::String
    iserr::Bool
end

const repl_runcode_request_type = JSONRPC.RequestType("repl/runcode", ReplRunCodeRequestParams, ReplRunCodeRequestReturn)
const repl_getvariables_request_type = JSONRPC.RequestType("repl/getvariables", Nothing, Vector{ReplGetVariablesRequestReturn})
# TODO Return type
const repl_getlazy_request_type = JSONRPC.RequestType("repl/getlazy", Int, Vector{Any})
const repl_showingrid_notification_type = JSONRPC.NotificationType("repl/showingrid", String)
const repl_loadedModules_request_type = JSONRPC.RequestType("repl/loadedModules", Nothing, Vector{String})
const repl_isModuleLoaded_request_type = JSONRPC.RequestType("repl/isModuleLoaded", String, Bool)
const repl_startdebugger_notification_type = JSONRPC.NotificationType("repl/startdebugger", String)
