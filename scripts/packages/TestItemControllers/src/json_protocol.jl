module TestItemControllerProtocol

import JSONRPC

using JSONRPC: @dict_readable, RequestType, NotificationType, Outbound

@dict_readable struct TestItem
    id::String
    uri::String
    label::String
    package_name::String
    package_uri::Union{Nothing,String}
    project_uri::Union{Nothing,String}
    env_content_hash::Union{Nothing,Int}
    useDefaultUsings::Bool
    testsetups::Vector{String}
    line::Int
    column::Int
    code::String
    mode::String
    # cover
end

@dict_readable struct TestMessage
    message::String
    expectedOutput::Union{Nothing,String}
    actualOutput::Union{Nothing,String}
    uri::Union{Nothing,String}
    line::Union{Nothing,Int}
    column::Union{Nothing,Int}
end

@dict_readable struct CreateTestRunParams
    testRunId::String
    kind::String
    testItems::Vector{TestItem}
end

const create_testrun_request_type = RequestType("createTestRun", CreateTestRunParams, Nothing)

@dict_readable struct CancelTestRunParams
    testRunId::String
end

const cancel_testrun_request_type = RequestType("cancelTestRun", CancelTestRunParams, Nothing)

const notficiationTypeTestRunFinished = NotificationType("testRunFinished", @NamedTuple{testRunId::String})

@dict_readable struct TestItemStartedParams <: Outbound
    testRunId::String
    testItemId::String
end


const notficiationTypeTestItemStarted = NotificationType("testItemStarted", TestItemStartedParams)

@dict_readable struct TestItemErroredParams <: Outbound
    testRunId::String
    testItemId::String
    messages::Vector{TestMessage}
    duration::Union{Missing,Float64}
end
const notficiationTypeTestItemErrored = NotificationType("testItemErrored", TestItemErroredParams)

@dict_readable struct TestItemFailedParams <: Outbound
    testRunId::String
    testItemId::String
    messages::Vector{TestMessage}
    duration::Union{Missing,Float64}
end
const notficiationTypeTestItemFailed = NotificationType("testItemFailed", TestItemFailedParams)

@dict_readable struct TestItemPassedParams <: Outbound
    testRunId::String
    testItemId::String
    duration::Union{Missing,Float64}
end

const notficiationTypeTestItemPassed = NotificationType("testItemPassed", TestItemPassedParams)
const notficiationTypeTestItemSkipped = NotificationType("testItemSkipped", @NamedTuple{testRunId::String,testItemId::String})

@dict_readable struct AppendOutputParams <: Outbound
    testRunId::String
    testItemId::Union{Nothing,String}
    output::String
end

const notficiationTypeAppendOutput = NotificationType("appendOutput", AppendOutputParams)

end
