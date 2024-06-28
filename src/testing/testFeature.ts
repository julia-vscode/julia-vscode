import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { uuid } from 'uuidv4'
import * as vscode from 'vscode'
import * as lsp from 'vscode-languageserver-protocol'
import { generatePipeName, inferJuliaNumThreads, registerCommand } from '../utils'
import * as net from 'net'
import * as rpc from 'vscode-jsonrpc/node'
import { Subject } from 'await-notify'
import { JuliaExecutablesFeature } from '../juliaexepath'
import * as path from 'path'
import { getCrashReportingPipename, handleNewCrashReportFromException } from '../telemetry'
import { getAbsEnvPath } from '../jlpkgenv'
import { TestProcessNode, WorkspaceFeature } from '../interactive/workspace'
import { cpus } from 'os'
import * as lcovParser from '@friedemannsommer/lcov-parser'
import * as vslc from 'vscode-languageclient/node'
import { onSetLanguageClient } from '../extension'
import { DebugConfigTreeProvider } from '../debugger/debugConfig'

enum TestRunMode {
    Normal,
    Debug,
    Coverage,
}

function modeAsString(mode: TestRunMode) {
    if(mode===TestRunMode.Normal) {
        return 'Normal'
    }
    else if(mode===TestRunMode.Debug) {
        return 'Debug'
    }
    else if(mode===TestRunMode.Coverage) {
        return 'Coverage'
    }
    else {
        throw(new Error(`Invalid mode value.`))
    }
}

interface TestItemDetail {
    id: string,
    label: string
    range: lsp.Range
    code?: string
    code_range?: lsp.Range
    option_default_imports?: boolean
    option_tags?: string[]
}

interface TestSetupDetail {
    name: string
    range: lsp.Range
    code?: string
    code_range?: lsp.Range
}

interface TestErrorDetail {
    range: lsp.Range
    error: string
}

interface PublishTestsParams {
    uri: lsp.URI
    version: number,
    testitemdetails: TestItemDetail[]
    testsetupdetails: TestSetupDetail[]
    testerrordetails: TestErrorDetail[]
}

interface TestserverRunTestitemRequestParams {
    uri: string
    name: string
    packageName: string
    useDefaultUsings: boolean
    line: number
    column: number
    code: string
    mode: string
}

interface TestMessage {
    message: string
    expectedOutput: string | null,
    actualOutput: string | null,
    location: lsp.Location
}
interface TestserverRunTestitemRequestParamsReturn {
    status: string
    message: TestMessage[] | null,
    duration: number | null,
    coverage: string | null
}

// interface GetTestEnvRequestParams {
//     uri: lsp.URI
// }

interface GetTestEnvRequestParamsReturn {
    package_name: string
    package_uri?: lsp.URI
    project_uri?: lsp.URI
    env_content_hash?: number
}

export const notifyTypeTextDocumentPublishTests = new lsp.ProtocolNotificationType<PublishTestsParams,void>('julia/publishTests')
// const requestGetTestEnv = new lsp.ProtocolRequestType<GetTestEnvRequestParams,GetTestEnvRequestParamsReturn,void,void,void>('julia/getTestEnv')
const requestTypeExecuteTestitem = new rpc.RequestType<TestserverRunTestitemRequestParams, TestserverRunTestitemRequestParamsReturn, void>('testserver/runtestitem')
const requestTypeRevise = new rpc.RequestType<void, string, void>('testserver/revise')

class MyFileCoverage extends vscode.FileCoverage {
    details: lcovParser.LineEntry[]

    constructor(uri: vscode.Uri, statementCoverage: vscode.TestCoverageCount, details: lcovParser.LineEntry[]) {
        super(uri, statementCoverage)
        this.details = details
    }
}


export class TestProcess {


    private process: ChildProcessWithoutNullStreams
    private connection: rpc.MessageConnection
    public testRun: vscode.TestRun | null = null
    public launchError: Error | null = null

    private plannedKill = false

    private _onKilled = new vscode.EventEmitter<void>()
    public onKilled = this._onKilled.event

    public project_uri: lsp.URI | null = null
    public package_uri: lsp.URI | null = null
    public packageName: string | null = null
    public testEnvContentHash: number

    public debugPipename: string = generatePipeName(uuid(), 'vsc-jl-td')
    public activeDebugSession: vscode.DebugSession | null = null

    constructor(public coverage: boolean) {}

    isConnected() {
        return this.connection
    }

    isBusy() {
        return this.testRun!==null
    }

    public async start(context: vscode.ExtensionContext, juliaExecutablesFeature: JuliaExecutablesFeature, outputChannel: vscode.OutputChannel, project_uri: lsp.URI | null, package_uri: lsp.URI | null, packageName: string, testEnvContentHash: number) {
        this.project_uri = project_uri
        this.package_uri = package_uri
        this.packageName = packageName
        this.testEnvContentHash = testEnvContentHash

        const pipename = generatePipeName(uuid(), 'vsc-jl-ts')

        const connected = new Subject()

        const server = net.createServer((socket: net.Socket) => {
            // socket.on('close', hadError => {
            //     g_onExit.fire(hadError)
            //     g_connection = undefined
            //     server.close()
            // })

            this.connection = rpc.createMessageConnection(
                new rpc.StreamMessageReader(socket),
                new rpc.StreamMessageWriter(socket)
            )

            this.connection.listen()

            connected.notify()
        })

        server.listen(pipename)

        const juliaExecutable = await juliaExecutablesFeature.getActiveJuliaExecutableAsync()

        const pkgenvpath = await getAbsEnvPath()

        const jlArgs = [
            `--project=${pkgenvpath}`,
            '--startup-file=no',
            '--history-file=no',
            '--depwarn=no'
        ]

        if(this.coverage) {
            // TODO Figure out whether we can still use this
            if(package_uri && false) {
                jlArgs.push(`--code-coverage=@${vscode.Uri.parse(package_uri).fsPath}`)
            }
            else {
                jlArgs.push('--code-coverage=user')
            }
        }

        const nthreads = inferJuliaNumThreads()

        if (nthreads==='auto') {
            jlArgs.push('--threads=auto')
        }

        const jlEnv = {
            JULIA_REVISE: 'off'
        }

        if (nthreads!=='auto' && nthreads!=='') {
            jlEnv['JULIA_NUM_THREADS'] = nthreads
        }

        this.process = spawn(
            juliaExecutable.file,
            [
                ...juliaExecutable.args,
                ...jlArgs,
                path.join(context.extensionPath, 'scripts', 'testserver', 'testserver_main.jl'),
                pipename,
                this.debugPipename,
                `v:${project_uri ? vscode.Uri.parse(project_uri).fsPath : ''}`,
                `v:${package_uri ? vscode.Uri.parse(package_uri).fsPath : ''}`,
                `v:${packageName}`,
                getCrashReportingPipename()
            ],
            {
                env: {
                    ...process.env,
                    ...jlEnv
                }
            }
        )

        this.process.stdout.on('data', data => {
            const dataAsString = String(data)
            if (this.testRun) {
                this.testRun.appendOutput(dataAsString.split('\n').join('\n\r'))
            }

            outputChannel.append(dataAsString)
        })

        this.process.stderr.on('data', data => {
            const dataAsString = String(data)
            if (this.testRun) {
                this.testRun.appendOutput(dataAsString.split('\n').join('\n\r'))
            }

            outputChannel.append(dataAsString)
        })

        this.process.on('exit', (code: number, signal: NodeJS.Signals) => {
            if(this.connection) {
                this.connection.dispose()
                this.connection = null
            }
            this._onKilled.fire()
        })

        this.process.on('error', (err: Error) => {
            connected.notify()
            handleNewCrashReportFromException(err, 'Extension')
            this.launchError = err
        })

        console.log(this.process.killed)

        await connected.wait()

        console.log('OK')
    }

    public async revise() {
        return await this.connection.sendRequest(requestTypeRevise, undefined)
    }

    public async kill() {
        this.plannedKill = true
        this.process.kill()
    }


    public async executeTest(testItem: vscode.TestItem, packageName: string, useDefaultUsings: boolean, location: lsp.Location, code: string, mode: TestRunMode, testRun: vscode.TestRun, someTestItemFinished: Subject) {
        this.testRun = testRun

        try {
            const result = await this.connection.sendRequest(requestTypeExecuteTestitem, { uri: location.uri, name: testItem.label, packageName: packageName, useDefaultUsings: useDefaultUsings, line: location.range.start.line, column: location.range.start.character, code: code, mode: modeAsString(mode) })

            if (result.status === 'passed') {
                if(result.coverage) {
                    const sections = await lcovParser.lcovParser({from: result.coverage})

                    for(const i of sections) {
                        const filePath = i.path

                        if (path.isAbsolute(filePath)) {

                            const pathAsUri = vscode.Uri.file(filePath)

                            if (vscode.workspace.workspaceFolders.filter(j => pathAsUri.toString().startsWith(j.uri.toString())).length>0) {
                                testRun.addCoverage(new MyFileCoverage(pathAsUri, {covered: i.lines.hit, total: i.lines.instrumented}, i.lines.details))
                            }
                        }
                    }
                }

                testRun.passed(testItem, result.duration)
            }
            else if (result.status === 'errored') {
                const message = new vscode.TestMessage(result.message[0].message)
                message.location = new vscode.Location(vscode.Uri.parse(result.message[0].location.uri), new vscode.Position(result.message[0].location.range.start.line, result.message[0].location.range.start.character))
                testRun.errored(testItem, message, result.duration)
            }
            else if (result.status === 'failed') {
                const messages = result.message.map(i => {
                    const message = new vscode.TestMessage(i.message)
                    message.location = new vscode.Location(vscode.Uri.parse(i.location.uri), new vscode.Position(i.location.range.start.line, i.location.range.start.character))
                    if (i.actualOutput !== null && i.expectedOutput !== null) {
                        message.actualOutput = i.actualOutput
                        message.expectedOutput = i.expectedOutput
                    }
                    return message
                })
                testRun.failed(testItem, messages, result.duration)
            }
            else {
                throw(new Error(`Unknown test result status ${result.status}.`))
            }

            this.testRun = null

            someTestItemFinished.notifyAll()
        }
        catch (err) {
            if((err.code === -32097 && testRun.token.isCancellationRequested) || (this.plannedKill)) {
                testRun.skipped(testItem)
                this.kill()
            }
            else {
                const message = new vscode.TestMessage('The test process crashed while running this test.')
                testRun.errored(testItem, message)

                this.kill()
            }
        }
    }

    public async startDebugging(compiledProvider) {
        await vscode.debug.startDebugging(
            undefined,
            {
                type: 'julia',
                request: 'attach',
                name: 'Julia Testitem',
                pipename: this.debugPipename,
                stopOnEntry: false,
                compiledModulesOrFunctions: compiledProvider.getCompiledItems(),
                compiledMode: compiledProvider.compiledMode
            }
        )
    }

    stopDebugging() {
        if(this.activeDebugSession) {
            vscode.debug.stopDebugging(this.activeDebugSession)
        }
    }
}

export class TestFeature {
    private controller: vscode.TestController
    private testitems: WeakMap<vscode.TestItem, TestItemDetail> = new WeakMap<vscode.TestItem, TestItemDetail>()
    private testProcesses: Map<string, TestProcess[]> = new Map<string, TestProcess[]>()
    public debugPipename2TestProcess: Map<string, TestProcess> = new Map<string, TestProcess>()
    private outputChannel: vscode.OutputChannel
    private someTestItemFinished = new Subject()
    private cpuLength: number | null = null
    private languageClient: vslc.LanguageClient = null

    constructor(private context: vscode.ExtensionContext, private executableFeature: JuliaExecutablesFeature, private workspaceFeature: WorkspaceFeature,private compiledProvider: DebugConfigTreeProvider) {
        try {
            this.outputChannel = vscode.window.createOutputChannel('Julia Testserver')

            this.controller = vscode.tests.createTestController(
                'juliaTests',
                'Julia Tests'
            )

            this.controller.createRunProfile(
                'Run',
                vscode.TestRunProfileKind.Run,
                async (request, token) => {
                    try {
                        await this.runHandler(request, TestRunMode.Normal, token)
                    }
                    catch (err) {
                        handleNewCrashReportFromException(err, 'Extension')
                        throw (err)
                    }
                },
                true
            )

            this.controller.createRunProfile(
                'Debug',
                vscode.TestRunProfileKind.Debug,
                async (request, token) => {
                    try {
                        await this.runHandler(request, TestRunMode.Debug, token)
                    }
                    catch (err) {
                        handleNewCrashReportFromException(err, 'Extension')
                        throw (err)
                    }
                },
                false
            )

            const coverage_profile = this.controller.createRunProfile('Run with coverage', vscode.TestRunProfileKind.Coverage, async (request, token) => {
                try {
                    await this.runHandler(request, TestRunMode.Coverage, token)
                }
                catch (err) {
                    handleNewCrashReportFromException(err, 'Extension')
                    throw (err)
                }
            }, true)

            coverage_profile.loadDetailedCoverage = async (testRun, fileCoverage: MyFileCoverage, token) => {
                return fileCoverage.details.map(i => {
                    return new vscode.StatementCoverage(i.hit, new vscode.Position(i.line-1, 0))
                })
            }

            context.subscriptions.push(
                registerCommand('language-julia.stopTestProcess', (node: TestProcessNode) =>
                    node.stop()
                )
            )

            vscode.debug.onDidStartDebugSession((session: vscode.DebugSession) => {
                if(session.configuration.pipename && this.debugPipename2TestProcess.has(session.configuration.pipename)) {
                    const testprocess = this.debugPipename2TestProcess.get(session.configuration.pipename)
                    testprocess.activeDebugSession = session
                }
            })

            vscode.debug.onDidTerminateDebugSession((session: vscode.DebugSession) => {
                if(session.configuration.pipename && this.debugPipename2TestProcess.has(session.configuration.pipename)) {
                    const testprocess = this.debugPipename2TestProcess.get(session.configuration.pipename)
                    testprocess.activeDebugSession = null
                }
            })

            this.cpuLength = cpus().length

            context.subscriptions.push(onSetLanguageClient(languageClient => {
                this.languageClient = languageClient
            }))
        }
        catch (err) {
            handleNewCrashReportFromException(err, 'Extension')
            throw (err)
        }
    }

    public publishTestsHandler(params: PublishTestsParams) {
        const uri = vscode.Uri.parse(params.uri)

        let fileTestitem = this.controller.items.get(params.uri)

        if (params.testitemdetails.length > 0) {
            if (!fileTestitem) {
                const filename = vscode.workspace.asRelativePath(uri.fsPath)

                fileTestitem = this.controller.createTestItem(params.uri, filename, uri)
                this.controller.items.add(fileTestitem)
            }

            fileTestitem.children.replace([
                ...params.testitemdetails.map(i => {
                    const testitem = this.controller.createTestItem(i.id, i.label, vscode.Uri.parse(params.uri))
                    testitem.tags = i.option_tags.map(j => new vscode.TestTag(j))
                    this.testitems.set(testitem, i)
                    testitem.range = new vscode.Range(i.range.start.line, i.range.start.character, i.range.end.line, i.range.end.character)

                    return testitem
                }),
                ...params.testerrordetails.map(i => {
                    const testitem = this.controller.createTestItem('Test error', 'Test error', vscode.Uri.parse(params.uri))
                    testitem.error = i.error
                    testitem.range = new vscode.Range(i.range.start.line, i.range.start.character, i.range.end.line, i.range.end.character)

                    return testitem
                })
            ])
        }
        else if (fileTestitem) {
            this.controller.items.delete(fileTestitem.id)
        }
    }

    walkTestTree(item: vscode.TestItem, itemsToRun: vscode.TestItem[]) {
        if (this.testitems.has(item)) {
            itemsToRun.push(item)
        }
        else {
            item.children.forEach(i=>this.walkTestTree(i, itemsToRun))
        }
    }

    stringifyTestItemDetail(testEnv: GetTestEnvRequestParamsReturn, coverage: boolean) {
        return JSON.stringify({projectPath: testEnv.project_uri, packagePath: testEnv.package_uri, packageName: testEnv.package_name, coverage: coverage})
    }

    async launchNewProcess(testEnv: GetTestEnvRequestParamsReturn, coverage: boolean) {
        const testProcess = new TestProcess(coverage)
        await testProcess.start(this.context, this.executableFeature, this.outputChannel, testEnv.project_uri, testEnv.package_uri, testEnv.package_name, testEnv.env_content_hash)
        this.workspaceFeature.addTestProcess(testProcess)

        if(!this.testProcesses.has(this.stringifyTestItemDetail(testEnv, coverage))) {
            this.testProcesses.set(this.stringifyTestItemDetail(testEnv, coverage), [])
        }

        const processes = this.testProcesses.get(this.stringifyTestItemDetail(testEnv, coverage))

        processes.push(testProcess)
        this.debugPipename2TestProcess.set(testProcess.debugPipename, testProcess)

        testProcess.onKilled((e) => {
            processes.splice(processes.indexOf(testProcess))
            this.debugPipename2TestProcess.delete(testProcess.debugPipename)
        })

        return testProcess
    }

    async getFreeTestProcess(testEnv: GetTestEnvRequestParamsReturn, coverage) {
        if(!this.testProcesses.has(this.stringifyTestItemDetail(testEnv, coverage))) {
            const testProcess = await this.launchNewProcess(testEnv, coverage)

            return testProcess
        }
        else {
            const testProcesses = this.testProcesses.get(this.stringifyTestItemDetail(testEnv, coverage))

            for(let testProcess of testProcesses) {
                // TODO Salsa Kill outdated test env processes here somewhere
                if(!testProcess.isBusy()) {
                    let needsNewProcess = false

                    if (!testProcess.isConnected()) {
                        needsNewProcess = true
                    }
                    else if(testProcess.testEnvContentHash !== testEnv.env_content_hash) {
                        await testProcess.kill()

                        this.outputChannel.appendLine('RESTARTING TEST SERVER BECAUSE ENVIRONMENT CHANGED')

                        needsNewProcess = true
                    }
                    else {
                        const status = await testProcess.revise()

                        if (status !== 'success') {
                            await testProcess.kill()

                            this.outputChannel.appendLine('RESTARTING TEST SERVER BECAUSE REVISE FAILED')

                            needsNewProcess = true
                        }

                    }

                    if (needsNewProcess) {
                        testProcess = await this.launchNewProcess(testEnv, coverage)
                    }

                    return testProcess
                }
            }

            let maxNumProcesses = vscode.workspace.getConfiguration('julia').get<number>('numTestProcesses')

            if(maxNumProcesses===0) {
                maxNumProcesses = this.cpuLength
            }

            if(testProcesses.length < maxNumProcesses) {
                const testProcess = await this.launchNewProcess(testEnv, coverage)

                return testProcess
            }
            else {
                return null
            }

        }
    }

    async runHandler(
        request: vscode.TestRunRequest,
        mode: TestRunMode,
        token: vscode.CancellationToken
    ) {
        const testRun = this.controller.createTestRun(request, undefined, true)

        try {

            testRun.token.onCancellationRequested(() => {
                for( const ps of this.testProcesses) {
                    for( const p of ps[1]) {
                        if(p.testRun === testRun && p.isBusy()) {
                            p.kill()
                        }
                    }
                }
                this.someTestItemFinished.notifyAll()
            })

            const itemsToRun: vscode.TestItem[] = []

            // TODO Handle exclude
            if (!request.include) {
                this.controller.items.forEach(i=>this.walkTestTree(i, itemsToRun))
            }
            else {
                request.include.forEach(i => this.walkTestTree(i, itemsToRun))
            }

            for (const i of itemsToRun) {
                testRun.enqueued(i)
            }

            const executionPromises = []

            const testEnvPerFile = new Map<vscode.Uri,GetTestEnvRequestParamsReturn>()

            const debugProcesses = new Set<TestProcess>()

            for (const i of itemsToRun) {
                if(testRun.token.isCancellationRequested) {
                    testRun.skipped(i)
                }
                else {
                    const details = this.testitems.get(i)

                    if (i.error) {
                        testRun.errored(i, new vscode.TestMessage(i.error))
                    }
                    else {
                        let testEnv: GetTestEnvRequestParamsReturn = undefined

                        if (testEnvPerFile.has(i.uri)) {
                            testEnv = testEnvPerFile.get(i.uri)
                        }
                        else {
                            testEnv = await this.languageClient.sendRequest<GetTestEnvRequestParamsReturn>('julia/getTestEnv', {uri: i.uri.toString()})
                            testEnvPerFile.set(i.uri, testEnv)
                        }

                        let testProcess: TestProcess = await this.getFreeTestProcess(testEnv, mode===TestRunMode.Coverage)

                        while(testProcess===null && !testRun.token.isCancellationRequested) {
                            await this.someTestItemFinished.wait()
                            testProcess = await this.getFreeTestProcess(testEnv, mode===TestRunMode.Coverage)
                        }

                        if(testProcess!==null) {

                            testRun.started(i)

                            if(testProcess.isConnected()) {
                                if(mode===TestRunMode.Debug && !testProcess.activeDebugSession) {
                                    await testProcess.startDebugging(this.compiledProvider)
                                    debugProcesses.add(testProcess)
                                }

                                const code = details.code

                                const location = {
                                    uri: i.uri.toString(),
                                    range: details.code_range
                                }

                                const executionPromise = testProcess.executeTest(i, testEnv.package_name, details.option_default_imports, location, code, mode, testRun, this.someTestItemFinished)

                                executionPromises.push(executionPromise)
                            }
                            else {
                                if(testProcess.launchError) {
                                    testRun.errored(i, new vscode.TestMessage(`Unable to launch the test process: ${testProcess.launchError.message}`))
                                }
                                else {
                                    testRun.errored(i, new vscode.TestMessage('Unable to launch the test process.'))
                                }
                            }
                        }
                    }
                }
            }

            await Promise.all(executionPromises)

            for(const i of debugProcesses) {
                i.stopDebugging()
            }
        }
        finally {
            testRun.end()
        }
    }

    public dispose() {

    }
}
