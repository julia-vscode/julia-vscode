import * as rpc from 'vscode-jsonrpc/node'

export const requestTypeCreateTestRun = new rpc.RequestType<{
    testRunId: string,
    kind: string,
    testItems: {
        id: string,
        uri: string,
        label: string,
        package_name: string,
        pacakge_uri?: string,
        project_uri?: string,
        env_content_hash?: number,
        useDefaultUsings: boolean,
        testsetups: string[],
        line: number,
        column: number,
        code: string,
        mode: string
    }[]
}, void, void>('createTestRun')

export const requestTypeCancelTestRun = new rpc.RequestType<{testRunId: string}, void, void>('cancelTestRun')

export const notficiationTypeTestRunFinished = new rpc.NotificationType<{testRunId: string}>('testRunFinished')

export const notficiationTypeTestItemStarted = new rpc.NotificationType<{testRunId: string, testItemId: string}>('testItemStarted')

export const notficiationTypeTestItemErrored = new rpc.NotificationType<{testRunId: string, testItemId: string, messages: string[], duration?: number}>('testItemErrored')

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
