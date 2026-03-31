import * as rpc from 'vscode-jsonrpc/node'

// Shared types

export interface FileCoverage {
    uri: string
    coverage: (number | null)[]
}

export interface TestMessageStackFrame {
    label: string
    uri?: string
    line?: number
    column?: number
}

export interface TestMessage {
    message: string
    expectedOutput?: string
    actualOutput?: string
    uri?: string
    line?: number
    column?: number
    stackTrace?: TestMessageStackFrame[]
}

// createTestRun request types

export interface TestEnvironment {
    id: string
    juliaCmd: string
    juliaArgs: string[]
    juliaNumThreads?: string
    juliaEnv: { [key: string]: string | null }
    mode: string
    packageName: string
    packageUri: string
    projectUri?: string
    envContentHash?: string
}

export interface TestRunItem {
    testitemId: string
    testEnvId: string
    timeout?: number
    logLevel: string
}

export interface TestItemDetail {
    id: string
    uri: string
    label: string
    packageName: string
    packageUri: string
    useDefaultUsings: boolean
    testSetups: string[]
    line: number
    column: number
    code: string
    codeLine: number
    codeColumn: number
}

export interface TestSetupDetail {
    packageUri: string
    name: string
    kind: string
    uri: string
    line: number
    column: number
    code: string
}

export interface CreateTestRunParams {
    testRunId: string
    testEnvironments: TestEnvironment[]
    testItems: TestItemDetail[]
    workUnits: TestRunItem[]
    testSetups: TestSetupDetail[]
    maxProcessCount: number
    coverageRootUris?: string[]
}

export interface CreateTestRunResponse {
    status: string
    coverage?: FileCoverage[]
}

export const requestTypeCreateTestRun = new rpc.RequestType<CreateTestRunParams, CreateTestRunResponse, void>(
    'createTestRun'
)

// terminateTestProcess request types

export interface TerminateTestProcessParams {
    testProcessId: string
}

export const requestTypeTerminateTestProcess = new rpc.RequestType<TerminateTestProcessParams, void, void>(
    'terminateTestProcess'
)

// Notification types from the controller to the extension

export interface TestItemStartedParams {
    testRunId: string
    testItemId: string
}

export const notficiationTypeTestItemStarted = new rpc.NotificationType<TestItemStartedParams>('testItemStarted')

export interface TestItemErroredParams {
    testRunId: string
    testItemId: string
    messages: TestMessage[]
    duration?: number
}

export const notficiationTypeTestItemErrored = new rpc.NotificationType<TestItemErroredParams>('testItemErrored')

export interface TestItemFailedParams {
    testRunId: string
    testItemId: string
    messages: TestMessage[]
    duration?: number
}

export const notficiationTypeTestItemFailed = new rpc.NotificationType<TestItemFailedParams>('testItemFailed')

export interface TestItemPassedParams {
    testRunId: string
    testItemId: string
    duration: number
}

export const notficiationTypeTestItemPassed = new rpc.NotificationType<TestItemPassedParams>('testItemPassed')

export interface TestItemSkippedParams {
    testRunId: string
    testItemId: string
}

export const notficiationTypeTestItemSkipped = new rpc.NotificationType<TestItemSkippedParams>('testItemSkipped')

export interface AppendOutputParams {
    testRunId: string
    testItemId?: string
    output: string
}

export const notificationTypeAppendOutput = new rpc.NotificationType<AppendOutputParams>('appendOutput')

export interface TestProcessCreatedParams {
    id: string
    packageName: string
    packageUri?: string
    projectUri?: string
    coverage: boolean
    env: { [key: string]: string }
}

export const notificationTypeTestProcessCreated = new rpc.NotificationType<TestProcessCreatedParams>(
    'testProcessCreated'
)

export interface TestProcessTerminatedParams {
    id: string
}

export const notificationTypeTestProcessTerminated = new rpc.NotificationType<TestProcessTerminatedParams>(
    'testProcessTerminated'
)

export interface TestProcessStatusChangedParams {
    id: string
    status: string
}

export const notificationTypeTestProcessStatusChanged = new rpc.NotificationType<TestProcessStatusChangedParams>(
    'testProcessStatusChanged'
)

export interface TestProcessOutputParams {
    id: string
    output: string
}

export const notificationTypeTestProcessOutput = new rpc.NotificationType<TestProcessOutputParams>('testProcessOutput')

export interface LaunchDebuggerParams {
    debugPipeName: string
    testRunId: string
}

export const notificationTypeLaunchDebugger = new rpc.NotificationType<LaunchDebuggerParams>('launchDebugger')
