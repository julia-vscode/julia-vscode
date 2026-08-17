import * as lsp from 'vscode-languageserver-protocol'

export interface TestItemDetail {
    id: string
    label: string
    range: lsp.Range
    code: string
    codeRange: lsp.Range
    optionDefaultImports: boolean
    optionTags: string[]
    optionSetup: string[]
    /** The `skip` kwarg: a literal `true`/`false`, or the source text of an expression that
     *  the test process evaluates just before the test item would run. */
    optionSkip: boolean | string
}

export interface TestSetupDetail {
    name: string
    kind: string
    range: lsp.Range
    code: string
    codeRange: lsp.Range
}

export interface TestErrorDetail {
    id: string
    label: string
    range: lsp.Range
    error: string
}

export interface PublishTestsParams {
    uri: lsp.URI
    /** Absent for a file the client never opened, and always absent for a deleted file. */
    version?: number
    testItemDetails: TestItemDetail[]
    testSetupDetails: TestSetupDetail[]
    testErrorDetails: TestErrorDetail[]
}

export const notifyTypeTextDocumentPublishTests = new lsp.ProtocolNotificationType<PublishTestsParams, void>(
    'julia/publishTests'
)

export interface GetTestEnvRequestParamsReturn {
    packageName?: string
    packageUri?: lsp.URI
    projectUri?: lsp.URI
    envContentHash?: string
}

export const requestTypJuliaGetTestEnv = new lsp.ProtocolRequestType<
    { uri: string },
    GetTestEnvRequestParamsReturn,
    void,
    void,
    void
>('julia/getTestEnv')
