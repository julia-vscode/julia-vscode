Base.@kwdef struct MarkdownString
    isTrusted::Bool = false
    supportThemeIcons::Bool = true
    value::String
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

struct Frame
    path::String
    line::Int
end
Frame(st::Base.StackFrame) = Frame(fullpath(string(st.file)), st.line)

JSONRPC.@dict_readable struct ReplRunCodeRequestReturn <: JSONRPC.Outbound
    inline::String
    all::String
    stackframe::Union{Nothing,Vector{Frame}}
end
ReplRunCodeRequestReturn(inline, all) = ReplRunCodeRequestReturn(inline, all, nothing)

JSONRPC.@dict_readable mutable struct ReplWorkspaceItem <: JSONRPC.Outbound
    head::String
    id::Int
    haschildren::Bool
    lazy::Bool
    icon::String
    value::String
    canshow::Bool
    type::String
end

JSONRPC.@dict_readable struct GetCompletionsRequestParams <: JSONRPC.Outbound
    line::String
    mod::String
end

struct ParameterInformation
    label::Union{String,UnitRange{Int}}
    documentation::Union{Missing,String,MarkdownString}
end

struct SignatureInformation
    activeParameter::Union{Missing,Int}
    documentation::Union{Missing,String,MarkdownString}
    label::String
    parameters::Vector{ParameterInformation}
end

struct SignatureHelp
    activeParameter::Int
    activeSignature::Int
    signatures::Vector{SignatureInformation}
end

struct SignatureHelpContext
    activeSignatureHelp::Union{Missing,SignatureHelp}
    isRetrigger::Bool
    triggerCharacter::Union{Missing,String}
    triggerKind::Int
end

JSONRPC.@dict_readable struct GetSignatureHelpRequestParams
    sig::String
    mod::String
    context::Dict # TODO: annotate with SignatureHelpContext
end

const repl_runcode_request_type = JSONRPC.RequestType("repl/runcode", ReplRunCodeRequestParams, ReplRunCodeRequestReturn)
const repl_getvariables_request_type = JSONRPC.RequestType("repl/getvariables", Nothing, Vector{ReplWorkspaceItem})
const repl_getlazy_request_type = JSONRPC.RequestType("repl/getlazy", Int, Vector{ReplWorkspaceItem})
const repl_showingrid_notification_type = JSONRPC.NotificationType("repl/showingrid", String)
const repl_loadedModules_request_type = JSONRPC.RequestType("repl/loadedModules", Nothing, Vector{String})
const repl_isModuleLoaded_request_type = JSONRPC.RequestType("repl/isModuleLoaded", String, Bool)
const repl_startdebugger_notification_type = JSONRPC.NotificationType("repl/startdebugger", String)
const repl_showprofileresult_notification_type = JSONRPC.NotificationType("repl/showprofileresult", String)
const repl_showprofileresult_file_notification_type = JSONRPC.NotificationType("repl/showprofileresult_file", String)
const repl_getcompletions_request_type = JSONRPC.RequestType("repl/getcompletions", GetCompletionsRequestParams, Vector{Dict})
const repl_resolvecompletion_request_type = JSONRPC.RequestType("repl/resolvecompletion", Dict, Dict)
const repl_getsignaturehelp_request_type = JSONRPC.RequestType("repl/getsignaturehelp", GetSignatureHelpRequestParams, SignatureHelp)
