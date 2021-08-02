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

JSONRPC.@dict_readable mutable struct DebugConfigTreeItem <: JSONRPC.Outbound
    label::String
    hasChildren::Bool
    juliaAccessor::String
end

const repl_runcode_request_type = JSONRPC.RequestType("repl/runcode", ReplRunCodeRequestParams, ReplRunCodeRequestReturn)
const repl_interrupt_notification_type = JSONRPC.NotificationType("repl/interrupt", Nothing)
const repl_getvariables_request_type = JSONRPC.RequestType("repl/getvariables", Nothing, Vector{ReplWorkspaceItem})
const repl_getlazy_request_type = JSONRPC.RequestType("repl/getlazy", NamedTuple{(:id,),Tuple{Int}}, Vector{ReplWorkspaceItem})
const repl_showingrid_notification_type = JSONRPC.NotificationType("repl/showingrid", NamedTuple{(:code,),Tuple{String}})
const repl_loadedModules_request_type = JSONRPC.RequestType("repl/loadedModules", Nothing, Vector{String})
const repl_isModuleLoaded_request_type = JSONRPC.RequestType("repl/isModuleLoaded", NamedTuple{(:mod,),Tuple{String}}, Bool)
const repl_startdebugger_notification_type = JSONRPC.NotificationType("repl/startdebugger", NamedTuple{(:debugPipename,),Tuple{String}})
const repl_showprofileresult_notification_type = JSONRPC.NotificationType("repl/showprofileresult", NamedTuple{(:content,),Tuple{String}})
const repl_showprofileresult_file_notification_type = JSONRPC.NotificationType("repl/showprofileresult_file", NamedTuple{(:filename,),Tuple{String}})
const repl_toggle_plot_pane_notification_type = JSONRPC.NotificationType("repl/togglePlotPane", NamedTuple{(:enable,),Tuple{Bool}})
const repl_toggle_diagnostics_notification_type = JSONRPC.NotificationType("repl/toggleDiagnostics", NamedTuple{(:enable,),Tuple{Bool}})
const repl_toggle_progress_notification_type = JSONRPC.NotificationType("repl/toggleProgress", Bool)
const cd_notification_type = JSONRPC.NotificationType("repl/cd", NamedTuple{(:uri,),Tuple{String}})
const activate_project_notification_type = JSONRPC.NotificationType("repl/activateProject", NamedTuple{(:uri,),Tuple{String}})
const repl_getdebugitems_request_type = JSONRPC.RequestType("repl/getDebugItems", NamedTuple{(:juliaAccessor,),Tuple{String}}, Vector{DebugConfigTreeItem})
