import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
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
    option_setup?: string[]
}

interface TestSetupDetail {
    name: string
    kind: string
    range: lsp.Range
    code?: string
    code_range?: lsp.Range
}

interface TestErrorDetail {
    id: string,
    label: string,
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
    testsetups: string[]
    line: number
    column: number
    code: string
    mode: string
    coverageRoots?: string[]
}

interface TestMessage {
    message: string
    expectedOutput?: string,
    actualOutput?: string,
    location: lsp.Location
}

interface FileCoverage {
    uri: string
    coverage: (number | null)[]
}

interface TestserverRunTestitemRequestParamsReturn {
    status: string
    messages?: TestMessage[],
    duration?: number,
    coverage?: FileCoverage[]
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

interface TestsetupDetails {
    name: string
    kind: string
    uri: lsp.URI
    line: number
    column: number
    code: string
}

interface TestserverUpdateTestsetupsRequestParams {
    testsetups: TestsetupDetails[]
}

export const notifyTypeTextDocumentPublishTests = new lsp.ProtocolNotificationType<PublishTestsParams,void>('julia/publishTests')
// const requestGetTestEnv = new lsp.ProtocolRequestType<GetTestEnvRequestParams,GetTestEnvRequestParamsReturn,void,void,void>('julia/getTestEnv')
const requestTypeExecuteTestitem = new rpc.RequestType<TestserverRunTestitemRequestParams, TestserverRunTestitemRequestParamsReturn, void>('testserver/runtestitem')
const requestTypeUpdateTestsetups = new rpc.RequestType<TestserverUpdateTestsetupsRequestParams,null,void>('testserver/updateTestsetups')
const requestTypeRevise = new rpc.RequestType<void, string, void>('testserver/revise')

interface OurFileCoverage extends vscode.FileCoverage {
    detailedCoverage: vscode.StatementCoverage[]
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

    public debugPipename: string = generatePipeName(uuidv4(), 'vsc-jl-td')
    public activeDebugSession: vscode.DebugSession | null = null

    constructor(public coverage: boolean) {}

    isConnected() {
        return this.connection
    }

    isBusy() {
        return this.testRun!==null
    }

    public async start(context: vscode.ExtensionContext, juliaExecutablesFeature: JuliaExecutablesFeature, outputChannel: vscode.OutputChannel, project_uri: lsp.URI | null, package_uri: lsp.URI | null, packageName: string, testEnvContentHash: number, testsetups: Map<vscode.Uri,TestSetupDetail[]>) {
        this.project_uri = project_uri
        this.package_uri = package_uri
        this.packageName = packageName
        this.testEnvContentHash = testEnvContentHash

        const pipename = generatePipeName(uuidv4(), 'vsc-jl-ts')

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

        await this.updateSetups(testsetups)

        console.log('OK')
    }

    public async revise() {
        return await this.connection.sendRequest(requestTypeRevise, undefined)
    }

    public async kill() {
        this.plannedKill = true
        this.process.kill()
    }

    async updateSetups(testsetups: Map<vscode.Uri,TestSetupDetail[]>) {
        const setups: TestsetupDetails[]  = []

        for(const i of testsetups.entries()) {
            for(const j of i[1]) {
                setups.push(
                    {
                        name: j.name,
                        kind: j.kind,
                        uri: i[0].toString(),
                        line: j.code_range.start.line+1, // We are 0 based in the extension, but 1 based in TestItemServer
                        column: j.code_range.start.character+1, // We are 0 based in the extension, but 1 based in TestItemServer
                        code: j.code
                    }
                )
            }
        }

        await this.connection.sendRequest(
            requestTypeUpdateTestsetups,
            {
                testsetups: setups
            }
        )
    }

    public async executeTest(testItem: vscode.TestItem, packageName: string, useDefaultUsings: boolean, testsetups: string[], location: lsp.Location, code: string, mode: TestRunMode, testRun: vscode.TestRun, someTestItemFinished: Subject) {
        this.testRun = testRun

        try {
            const result = await this.connection.sendRequest(
                requestTypeExecuteTestitem,
                {
                    uri: location.uri,
                    name: testItem.label,
                    packageName: packageName,
                    useDefaultUsings: useDefaultUsings,
                    testsetups: testsetups,
                    line: location.range.start.line + 1, // We are 0 based in the extension, but 1 based in TestItemServer
                    column: location.range.start.character + 1, // We are 0 based in the extension, but 1 based in TestItemServer
                    code: code,
                    mode: modeAsString(mode),
                    coverageRoots: (mode !== TestRunMode.Coverage || !vscode.workspace.workspaceFolders) ? undefined : vscode.workspace.workspaceFolders.map(i=>i.uri.toString())
                }
            )

            if (result.status === 'passed') {
                if(result.coverage) {
                    for(const file of result.coverage) {
                        const uri = vscode.Uri.parse(file.uri)

                        if (vscode.workspace.workspaceFolders.filter(j => file.uri.startsWith(j.uri.toString())).length>0) {
                            const statementCoverage = file.coverage.map((value,index)=>{
                                if(value!==null) {
                                    return new vscode.StatementCoverage(value, new vscode.Position(index, 0))
                                }
                                else {
                                    return null
                                }
                            }).filter(i=>i!==null)

                            testRun.addCoverage(vscode.FileCoverage.fromDetails(uri, statementCoverage))
                        }
                    }
                }

                testRun.passed(testItem, result.duration)
            }
            else if (result.status === 'errored') {
                const message = new vscode.TestMessage(result.messages[0].message)
                message.location = new vscode.Location(vscode.Uri.parse(result.messages[0].location.uri), new vscode.Position(result.messages[0].location.range.start.line-1, result.messages[0].location.range.start.character-1))
                testRun.errored(testItem, message, result.duration)
            }
            else if (result.status === 'failed') {
                const messages = result.messages.map(i => {
                    const message = new vscode.TestMessage(i.message)
                    message.location = new vscode.Location(vscode.Uri.parse(i.location.uri), new vscode.Position(i.location.range.start.line-1, i.location.range.start.character-1))
                    if (i.actualOutput !== undefined && i.expectedOutput !== undefined) {
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
            },
            {
                testRun: this.testRun
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
    private testsetups: Map<vscode.Uri,TestSetupDetail[]> = new Map<vscode.Uri,TestSetupDetail[]>()
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

            coverage_profile.loadDetailedCoverage = async (testRun, fileCoverage: OurFileCoverage, token) => {
                return fileCoverage.detailedCoverage
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

        const niceFilename = vscode.workspace.asRelativePath(uri.fsPath, false)
        const shortFilename = path.basename(niceFilename)
        const filenameParts = path.dirname(niceFilename).split('/')
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri)

        if(!workspaceFolder) {
            // Test file that is outside of the workspace, we skip
            return
        }

        if (params.testitemdetails.length > 0 || params.testerrordetails.length > 0) {
            // First see whether we already have the workspace folder
            let currentFolder = this.controller.items.get(workspaceFolder.name)
            let currentUri = workspaceFolder.uri
            if(!currentFolder) {
                currentFolder = this.controller.createTestItem(workspaceFolder.name, workspaceFolder.name, currentUri)
                this.controller.items.add(currentFolder)
            }

            for(const part of filenameParts) {
                currentUri = currentUri.with({path: `${currentUri.path}/${part}`})
                let newChild = currentFolder.children.get(part)
                if(!newChild) {
                    newChild = this.controller.createTestItem(part, part, currentUri)
                    currentFolder.children.add(newChild)
                }
                currentFolder = newChild
            }


            let fileTestitem = currentFolder.children.get(shortFilename)
            if (!fileTestitem) {
                fileTestitem = this.controller.createTestItem(shortFilename, shortFilename, uri)
                currentFolder.children.add(fileTestitem)
            }

            fileTestitem.children.forEach(i=>this.testitems.delete(i))

            fileTestitem.children.replace([
                ...params.testitemdetails.map(i => {
                    const testitem = this.controller.createTestItem(i.id, i.label, uri)
                    testitem.tags = i.option_tags.map(j => new vscode.TestTag(j))
                    testitem.range = new vscode.Range(i.range.start.line, i.range.start.character, i.range.end.line, i.range.end.character)

                    this.testitems.set(testitem, i)

                    return testitem
                }),
                ...params.testerrordetails.map(i => {
                    const testitem = this.controller.createTestItem(i.id, i.label, uri)
                    testitem.error = i.error
                    testitem.range = new vscode.Range(i.range.start.line, i.range.start.character, i.range.end.line, i.range.end.character)

                    return testitem
                })
            ])
        }
        else {
            let currentFolder = this.controller.items.get(workspaceFolder.name)
            if(currentFolder) {
                let foundParentFolder = true
                for(const part of filenameParts) {
                    const child = currentFolder.children.get(part)
                    if(!child) {
                        foundParentFolder = false
                        break
                    }
                    currentFolder = child
                }

                if(foundParentFolder) {
                    const fileTestitem = currentFolder.children.get(shortFilename)
                    if (fileTestitem) {
                        fileTestitem.children.forEach(i=>this.testitems.delete(i))
                        currentFolder.children.delete(shortFilename)
                    }

                }

                while(currentFolder) {
                    const parentFolder = currentFolder.parent
                    if(currentFolder.children.size===0) {
                        if(parentFolder) {
                            parentFolder.children.delete(currentFolder.id)
                        }
                        else {
                            this.controller.items.delete(currentFolder.id)
                        }
                    }
                    currentFolder = parentFolder
                }

            }
        }

        this.testsetups.set(uri, params.testsetupdetails)
        for(const procs of this.testProcesses.values()) {
            for(const proc of procs) {
                proc.updateSetups(this.testsetups)
            }
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
        await testProcess.start(this.context, this.executableFeature, this.outputChannel, testEnv.project_uri, testEnv.package_uri, testEnv.package_name, testEnv.env_content_hash, this.testsetups)
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

    isParentOf(x: vscode.TestItem, y: vscode.TestItem) {
        if(y.parent) {
            if(y.parent===x) {
                return true
            }
            else {
                return this.isParentOf(x, y.parent)
            }
        }
        else {
            return false
        }
    }

    async runHandler(
        request: vscode.TestRunRequest,
        mode: TestRunMode,
        token: vscode.CancellationToken
    ) {
        if(mode===TestRunMode.Coverage) {
            const ex = await this.executableFeature.getActiveJuliaExecutableAsync()
            if(ex.getVersion().compare('1.11.0-rc2')===-1) {
                vscode.window.showErrorMessage('Running tests with coverage requires Julia 1.11 or newer.')
                return
            }
        }

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

            let itemsToRun: vscode.TestItem[] = []

            if (!request.include) {
                this.controller.items.forEach(i=>this.walkTestTree(i, itemsToRun))
            }
            else {
                request.include.forEach(i => this.walkTestTree(i, itemsToRun))
            }

            if(request.exclude) {
                itemsToRun = itemsToRun.filter(i => !request.exclude.includes(i) && request.exclude.every(j => !this.isParentOf(j, i)))
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

                                const executionPromise = testProcess.executeTest(i, testEnv.package_name, details.option_default_imports, details.option_setup,  location, code, mode, testRun, this.someTestItemFinished)

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
