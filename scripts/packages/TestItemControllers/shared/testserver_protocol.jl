module TestItemServerProtocol

import ..JSONRPC
import ..JSONRPC.JSON

using ..JSONRPC: @dict_readable, RequestType, NotificationType, Outbound

@dict_readable struct Position <: JSONRPC.Outbound
    line::Int
    character::Int
end

struct Range
    start::Position
    stop::Position
end
function Range(d::Dict)
    Range(Position(d["start"]), Position(d["end"]))
end
function JSON.lower(a::Range)
    Dict("start" => a.start, "end" => a.stop)
end

@dict_readable struct Location <: JSONRPC.Outbound
    uri::String
    position::Position
end

@dict_readable struct TestMessage <: JSONRPC.Outbound
    message::String
    expectedOutput::Union{String,Missing}
    actualOutput::Union{String,Missing}
    location::Location
end

TestMessage(message, location) = TestMessage(message, missing, missing, location)

@dict_readable struct RunTestItem <: JSONRPC.Outbound
    id::String
    uri::String
    name::String
    packageName::String
    useDefaultUsings::Bool
    testsetups::Vector{String}
    line::Int
    column::Int
    code::String
    mode::String
    coverageRoots::Union{Vector{String},Missing}
end

@dict_readable struct FileCoverage <: JSONRPC.Outbound
    uri::String
    coverage::Vector{Union{Int,Nothing}}
end

@dict_readable struct TestsetupDetails <: JSONRPC.Outbound
    name::String
    kind::String
    uri::String
    line::Int
    column::Int
    code::String
end

@dict_readable struct RunTestitemRequestParams <: JSONRPC.Outbound
    testrunId::String
    testitems::Vector{RunTestItem}
    testsetups::Vector{TestsetupDetails}
end

const testserver_revise_request_type = JSONRPC.RequestType("testserver/revise", Nothing, String)
const run_testitems_request_type = JSONRPC.RequestType("runtestitems", RunTestitemRequestParams, Nothing)

@dict_readable struct ActivateEnvParams <: JSONRPC.Outbound
    testrunId::String
    project_path::Union{Nothing,String}
    package_path::String
    package_name::String
end

const testserver_activate_env_request_type = JSONRPC.RequestType("activateEnv", ActivateEnvParams, Nothing)

@dict_readable struct StartedParams <: JSONRPC.Outbound
    testrun_id::String
    testitem_id::String
end

const started_notification_type = JSONRPC.NotificationType("started", StartedParams)

@dict_readable struct PassedParams <: JSONRPC.Outbound
    testrun_id::String
    testitem_id::String
    duration::Float64
    coverage::Union{Missing,Vector{FileCoverage}}
end

const passed_notification_type = JSONRPC.NotificationType("passed", PassedParams)

@dict_readable struct ErroredParams <: JSONRPC.Outbound
    testrun_id::String
    testitem_id::String
    messages::Vector{TestMessage}
    duration::Union{Float64,Missing}
end

const errored_notification_type = JSONRPC.NotificationType("errored", ErroredParams)

@dict_readable struct FailedParams <: JSONRPC.Outbound
    testrun_id::String
    testitem_id::String
    messages::Vector{TestMessage}
    duration::Union{Float64,Missing}
end

const failed_notification_type = JSONRPC.NotificationType("failed", FailedParams)

@dict_readable struct AppendOutputParams <: JSONRPC.Outbound
    testrun_id::String
    testitem_id::Union{Nothing,String}
    output::String
end

const append_output_notification_type = JSONRPC.NotificationType("appendOutput", AppendOutputParams)

end
