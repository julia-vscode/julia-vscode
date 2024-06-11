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
    showErrorInREPL::Bool
    softscope::Bool
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
ReplRunCodeRequestReturn(inline, all=inline) = ReplRunCodeRequestReturn(inline, all, nothing)

JSONRPC.@dict_readable mutable struct Location <: JSONRPC.Outbound
    file::String
    line::Int
end

JSONRPC.@dict_readable mutable struct ReplWorkspaceItem <: JSONRPC.Outbound
    head::String
    id::Int
    haschildren::Bool
    lazy::Bool
    icon::String
    value::String
    canshow::Bool
    type::String
    location::Union{Nothing, Location}
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

JSONRPC.@dict_readable mutable struct DebugConfigTreeItem <: JSONRPC.Outbound
    label::String
    hasChildren::Bool
    juliaAccessor::String
end

JSONRPC.@dict_readable mutable struct GetTableDataRequest <: JSONRPC.Outbound
    id::String
    startRow::Int
    endRow::Int
    filterModel::Any
    sortModel::Any
end

JSONRPC.@dict_readable mutable struct ProfileFrame <: JSONRPC.Outbound
    func::String
    file::String # human readable file name
    path::String # absolute path
    line::Int # 1-based line number
    count::Int # number of samples in this frame
    countLabel::Union{Missing,String} # defaults to `$count samples`
    flags::UInt8 # any or all of ProfileFrameFlag
    taskId::Union{Missing,UInt}
    children::Vector{ProfileFrame}
end

const repl_runcode_request_type = JSONRPC.RequestType("repl/runcode", ReplRunCodeRequestParams, ReplRunCodeRequestReturn)
const repl_interrupt_notification_type = JSONRPC.NotificationType("repl/interrupt", Nothing)
const repl_getvariables_request_type = JSONRPC.RequestType("repl/getvariables", NamedTuple{(:modules,),Tuple{Bool}}, Vector{ReplWorkspaceItem})
const repl_getlazy_request_type = JSONRPC.RequestType("repl/getlazy", NamedTuple{(:id,),Tuple{Int}}, Vector{ReplWorkspaceItem})
const repl_showingrid_notification_type = JSONRPC.NotificationType("repl/showingrid", NamedTuple{(:code,),Tuple{String}})
const repl_loadedModules_request_type = JSONRPC.RequestType("repl/loadedModules", Nothing, Vector{String})
const repl_isModuleLoaded_request_type = JSONRPC.RequestType("repl/isModuleLoaded", NamedTuple{(:mod,),Tuple{String}}, Bool)
const repl_showprofileresult_notification_type = JSONRPC.NotificationType("repl/showprofileresult", NamedTuple{(:trace,:typ),Tuple{Dict{String,ProfileFrame}, String}})
const repl_open_file_notification_type = JSONRPC.NotificationType("repl/openFile", NamedTuple{(:path, :line, :preserveFocus), Tuple{String, Int, Bool}})
const repl_toggle_plot_pane_notification_type = JSONRPC.NotificationType("repl/togglePlotPane", NamedTuple{(:enable,),Tuple{Bool}})
const repl_toggle_diagnostics_notification_type = JSONRPC.NotificationType("repl/toggleDiagnostics", NamedTuple{(:enable,),Tuple{Bool}})
const repl_toggle_inlay_hints_notification_type = JSONRPC.NotificationType("repl/toggleInlayHints", NamedTuple{(:enable,),Tuple{Bool}})
const repl_toggle_progress_notification_type = JSONRPC.NotificationType("repl/toggleProgress", NamedTuple{(:enable,),Tuple{Bool}})
const cd_notification_type = JSONRPC.NotificationType("repl/cd", NamedTuple{(:uri,),Tuple{String}})
const activate_project_notification_type = JSONRPC.NotificationType("repl/activateProject", NamedTuple{(:uri,),Tuple{String}})
const repl_getdebugitems_request_type = JSONRPC.RequestType("repl/getDebugItems", NamedTuple{(:juliaAccessor,),Tuple{String}}, Vector{DebugConfigTreeItem})

const repl_gettabledata_request_type = JSONRPC.RequestType("repl/getTableData", GetTableDataRequest, Any)
const repl_clearlazytable_notification_type = JSONRPC.NotificationType("repl/clearLazyTable", NamedTuple{(:id,),Tuple{String}})

const repl_getcompletions_request_type = JSONRPC.RequestType("repl/getcompletions", GetCompletionsRequestParams, Vector)
const repl_resolvecompletion_request_type = JSONRPC.RequestType("repl/resolvecompletion", Dict, Dict)
