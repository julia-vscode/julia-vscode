import * as rpc from 'vscode-jsonrpc/node'

interface FileCoverage {
    uri: string
    coverage: (number | null)[]
}

// Messages from the extension to the controller

export const requestTypeCreateTestRun = new rpc.RequestType<{
    testRunId: string,
    maxProcessCount: number,
    testItems: {
        id: string,
        uri: string,
        label: string,
        packageName: string,
        packageUri?: string,
        projectUri?: string,
        envCcontentHash?: number,
        juliaCmd: string,
        juliaArgs: string[],
        juliaNumThreads: string,
        juliaEnv: { [key: string]: string | null },
        useDefaultUsings: boolean,
        testSetups: string[],
        line: number,
        column: number,
        code: string,
        mode: string
    }[],
    testSetups: {
        packageUri: string,
        name: string,
        kind: string,
        uri: string,
        line: number,
        column: number
        code: string
    }[],
    coverageRootUris?: string[]
}, void, void>('createTestRun')

export const requestTypeCancelTestRun = new rpc.RequestType<{testRunId: string}, void, void>('cancelTestRun')

export const requestTypeTerminateTestProcess = new rpc.RequestType<{testProcessId: string}, void, void>('terminateTestProcess')

// Messages from the controller to the extension

export const notficiationTypeTestRunFinished = new rpc.NotificationType<{testRunId: string, coverage?: FileCoverage[]}>('testRunFinished')

export const notficiationTypeTestItemStarted = new rpc.NotificationType<{testRunId: string, testItemId: string}>('testItemStarted')

export const notficiationTypeTestItemErrored = new rpc.NotificationType<{
    testRunId: string,
    testItemId: string,
    messages: {
        message: string,
        expectedOutput?: string,
        actualOutput?: string,
        uri?: string,
        line?: number,
        column?: number
    }[],
    duration?: number
}>('testItemErrored')

export const notficiationTypeTestItemFailed = new rpc.NotificationType<{
    testRunId: string,
    testItemId: string,
    messages: {
        message: string,
        expectedOutput?: string,
        actualOutput?: string,
        uri?: string,
        line?: number,
        column?: number
    }[],
    duration?: number
}>('testItemFailed')

export const notficiationTypeTestItemPassed = new rpc.NotificationType<{testRunId: string, testItemId: string, duration: number}>('testItemPassed')

export const notficiationTypeTestItemSkipped = new rpc.NotificationType<{testRunId: string, testItemId: string}>('testItemSkipped')

export const notificationTypeAppendOutput = new rpc.NotificationType<{testRunId: string, testItemId?: string, output: string}>('appendOutput')

export const notificationTypeTestProcessCreated = new rpc.NotificationType<{id: string, packageName: string, packageUri?: string, projectUri?: string, coverage: boolean, env: any}>('testProcessCreated')

export const notificationTypeTestProcessTerminated = new rpc.NotificationType<string>('testProcessTerminated')

export const notificationTypeTestProcessStatusChanged = new rpc.NotificationType<{id: string, status: string}>('testProcessStatusChanged')

export const notificationTypeLaunchDebuggers = new rpc.NotificationType<{debugPipeNames: string[], testRunId: string}>('launchDebuggers')
