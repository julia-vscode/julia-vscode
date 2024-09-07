module TestItemControllerProtocol

import JSONRPC

using JSONRPC: @dict_readable, RequestType, NotificationType, Outbound

@dict_readable struct TestItem
    id::String
    uri::String
    label::String
    packageName::String
    packageUri::Union{Missing,String}
    projectUri::Union{Missing,String}
    envContentHash::Union{Missing,Int}
    juliaCmd::String
    juliaArgs::Vector{String}
    juliaNumThreads::String
    juliaEnv::Dict{String,Union{String,Nothing}}
    useDefaultUsings::Bool
    testSetups::Vector{String}
    line::Int
    column::Int
    code::String
    mode::String
    # cover
end

@dict_readable struct TestSetupDetail
    packageUri::String
    name::String
    kind::String
    uri::String
    line::Int
    column::Int
    code::String
end

@dict_readable struct TestMessage
    message::String
    expectedOutput::Union{Missing,String}
    actualOutput::Union{Missing,String}
    uri::Union{Missing,String}
    line::Union{Missing,Int}
    column::Union{Missing,Int}
end

@dict_readable struct CreateTestRunParams
    testRunId::String
    maxProcessCount::Int
    testItems::Vector{TestItem}
    testSetups::Vector{TestSetupDetail}
    coverageRootUris::Union{Missing,Vector{String}}
end

const create_testrun_request_type = RequestType("createTestRun", CreateTestRunParams, Nothing)

@dict_readable struct CancelTestRunParams
    testRunId::String
end

const cancel_testrun_request_type = RequestType("cancelTestRun", CancelTestRunParams, Nothing)

@dict_readable struct TerminateTestProcessParams
    testProcessId::String
end

const terminate_test_process_request_type = RequestType("terminateTestProcess", TerminateTestProcessParams, Nothing)

@dict_readable struct FileCoverage <: JSONRPC.Outbound
    uri::String
    coverage::Vector{Union{Int,Nothing}}
end

@dict_readable struct TestRunFinishedParams <: Outbound
    testRunId::String
    coverage::Union{Missing,Vector{FileCoverage}}
end

const notficiationTypeTestRunFinished = NotificationType("testRunFinished", TestRunFinishedParams)

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
    testItemId::Union{Missing,String}
    output::String
end

const notficiationTypeAppendOutput = NotificationType("appendOutput", AppendOutputParams)

@dict_readable struct TestProcessCreatedParams
    id::String
    packageName::String
    packageUri::Union{Missing,String}
    projectUri::Union{Missing,String}
    coverage::Bool
    env::Dict{String,String}
end

const notificationTypeTestProcessCreated = NotificationType("testProcessCreated", TestProcessCreatedParams)

const notificationTypeTestProcessTerminated = NotificationType("testProcessTerminated", String)

@dict_readable struct TestProcessStatusChangedParams
    id::String
    status::String
end

const notificationTypeTestProcessStatusChanged = NotificationType("testProcessStatusChanged", TestProcessStatusChangedParams)

const notificationTypeLaunchDebuggers = NotificationType("launchDebuggers", @NamedTuple{debugPipeNames::Vector{String}, testRunId::String})

end
