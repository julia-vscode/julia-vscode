import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc/node'
import { JuliaExecutablesFeature } from '../juliaexepath'
import * as path from 'path'
import { getCrashReportingPipename, handleNewCrashReportFromException } from '../telemetry'
import { TestControllerNode, TestProcessNode, WorkspaceFeature } from '../interactive/workspace'
import { cpus } from 'os'
import * as vslc from 'vscode-languageclient/node'
import { onSetLanguageClient } from '../extension'
import { notficiationTypeTestItemErrored, notficiationTypeTestItemFailed, notficiationTypeTestItemPassed, notficiationTypeTestItemSkipped, notficiationTypeTestItemStarted, notificationTypeAppendOutput, notificationTypeLaunchDebugger, notificationTypeTestProcessCreated, notificationTypeTestProcessOutput, notificationTypeTestProcessStatusChanged, notificationTypeTestProcessTerminated, requestTypeCreateTestRun, requestTypeTerminateTestProcess } from './testControllerProtocol'
import * as tlsp from './testLSProtocol'
import { DebugConfigTreeProvider } from '../debugger/debugConfig'
import { inferJuliaNumThreads, registerCommand } from '../utils'

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

interface OurFileCoverage extends vscode.FileCoverage {
    detailedCoverage: vscode.StatementCoverage[]
}

export class JuliaTestProcess {
    private status: string

    private _onStatusChanged = new vscode.EventEmitter<void>()
    public onStatusChanged = this._onStatusChanged.event

    constructor(
        public id: string,
        public packageName: string,
        public packageUri: string | undefined,
        public projectUri: string | undefined,
        public coverage: boolean | undefined,
        public env: any,
        private controller: JuliaTestController) {
        this.status = 'Created'
    }

    setStatus(status: string) {
        this.status = status
        this._onStatusChanged.fire()
    }

    public getStatus() {
        return this.status
    }

    kill() {
        this.controller.killTestProcess(this.id)
    }
}

export class JuliaTestController {
    private _onKilled = new vscode.EventEmitter<void>()
    public onKilled = this._onKilled.event

    kill() {
        this.process.kill()
    }

    private connection: rpc.MessageConnection
    private process: ChildProcessWithoutNullStreams
    private testRuns = new Map<string,{testRun: vscode.TestRun, testItems: Map<string,vscode.TestItem>}>()
    private testProcesses = new Map<string,JuliaTestProcess>()

    constructor(
        private testFeature: TestFeature,
        private juliaExecutablesFeature: JuliaExecutablesFeature,
        private workspaceFeature: WorkspaceFeature,
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel,
        private compiledProvider: DebugConfigTreeProvider) {

    }

    public ready() {
        return this.process
    }

    killTestProcess(id: string) {
        this.connection.sendRequest(requestTypeTerminateTestProcess, {testProcessId: id})
    }

    public async start() {
        this.workspaceFeature.addTestController(this)

        // TODO Make this much more robust
        const exePaths = await this.juliaExecutablesFeature.getJuliaExePathsAsync()
        const releaseChannelExe = exePaths.filter(i=>i.channel==='release')
        const juliaExecutable = releaseChannelExe[0]

        const jlArgs = [
            '--startup-file=no',
            '--history-file=no',
            '--depwarn=no'
        ]

        this.process = spawn(
            juliaExecutable.file,
            [
                ...juliaExecutable.args,
                ...jlArgs,
                path.join(this.context.extensionPath, 'scripts', 'apps', 'testitemcontroller_main.jl'),
                getCrashReportingPipename()
            ],
            {
                detached: false
            }
        )

        this.connection = rpc.createMessageConnection(this.process.stdout, this.process.stdin)
        this.connection.onNotification(notficiationTypeTestItemStarted, i=>{
            const testRun = this.testRuns.get(i.testRunId)
            const testItem = testRun.testItems.get(i.testItemId)

            testRun.testRun.started(testItem)
        })
        this.connection.onNotification(notficiationTypeTestItemErrored, i=>{
            const testRun = this.testRuns.get(i.testRunId)
            const testItem = testRun.testItems.get(i.testItemId)

            testRun.testRun.errored(testItem, i.messages.map(i=>{
                const msg = new vscode.TestMessage(i.message)
                if(i.uri && i.line && i.column) {
                    msg.location = new vscode.Location(vscode.Uri.parse(i.uri), new vscode.Position(i.line-1, i.column-1))
                }
                return msg
            }), i.duration)
        })
        this.connection.onNotification(notficiationTypeTestItemFailed, i=>{
            const testRun = this.testRuns.get(i.testRunId)
            const testItem = testRun.testItems.get(i.testItemId)

            testRun.testRun.failed(testItem, i.messages.map(i=>{
                const msg = new vscode.TestMessage(i.message)
                msg.actualOutput = i.actualOutput
                msg.expectedOutput = i.expectedOutput
                if (i.uri && i.line && i.column) {
                    msg.location = new vscode.Location(vscode.Uri.parse(i.uri), new vscode.Position(i.line-1, i.column-1))
                }
                return msg
            }), i.duration)
        })
        this.connection.onNotification(notficiationTypeTestItemPassed, i=>{
            const testRun = this.testRuns.get(i.testRunId)
            const testItem = testRun.testItems.get(i.testItemId)

            testRun.testRun.passed(testItem, i.duration)
        })
        this.connection.onNotification(notficiationTypeTestItemSkipped, i=>{
            const testRun = this.testRuns.get(i.testRunId)
            const testItem = testRun.testItems.get(i.testItemId)

            testRun.testRun.skipped(testItem)
        })
        this.connection.onNotification(notificationTypeAppendOutput, i=>{
            const testRun = this.testRuns.get(i.testRunId)
            const testItem = i.testItemId ? testRun.testItems.get(i.testItemId) : undefined

            testRun.testRun.appendOutput(i.output, undefined, testItem)
        })
        this.connection.onNotification(notificationTypeTestProcessCreated, i=>{
            const tp = new JuliaTestProcess(
                i.id,
                i.packageName,
                i.packageUri,
                i.projectUri,
                i.coverage,
                i.env,
                this
            )
            this.testProcesses.set(i.id, tp)
            this.workspaceFeature.addTestProcess(tp)
        })
        this.connection.onNotification(notificationTypeTestProcessStatusChanged, i=>{
            const tp = this.testProcesses.get(i.id)
            tp.setStatus(i.status)
        })
        this.connection.onNotification(notificationTypeTestProcessOutput, i=>{
            if (!this.testFeature.juliaTestProcessOutputChannels.has(i.id)) {
                const newOutputChannel = vscode.window.createOutputChannel(`Julia Test Process ${i.id}`)
                this.testFeature.juliaTestProcessOutputChannels.set(i.id, newOutputChannel)
            }

            const outputChannel = this.testFeature.juliaTestProcessOutputChannels.get(i.id)
            outputChannel.append(i.output)
        })
        this.connection.onNotification(notificationTypeTestProcessTerminated, i=>{
            const tp = this.testProcesses.get(i.id)
            this.workspaceFeature.removeTestProcess(tp)
            this.testProcesses.delete(i.id)

            if (this.testFeature.juliaTestProcessOutputChannels.has(i.id)) {
                const outputChanenl = this.testFeature.juliaTestProcessOutputChannels.get(i.id)
                outputChanenl.dispose()
                this.testFeature.juliaTestProcessOutputChannels.delete(i.id)
            }
        })
        this.connection.onNotification(notificationTypeLaunchDebugger, async i=>{
            const testRun = this.testRuns.get(i.testRunId)
            await vscode.debug.startDebugging(
                undefined,
                {
                    type: 'julia',
                    request: 'attach',
                    name: 'Julia Testitem',
                    pipename: i.debugPipeName,
                    stopOnEntry: false,
                    compiledModulesOrFunctions: this.compiledProvider.getCompiledItems(),
                    compiledMode: this.compiledProvider.compiledMode
                },
                {
                    testRun: testRun.testRun
                }
            )
        })
        this.connection.listen()

        this.process.stderr.on('data', data => {
            const dataAsString = String(data)
            this.outputChannel.append(dataAsString)
        })

        this.process.on('exit', (code: number, signal: NodeJS.Signals) => {
            this.process = undefined

            if(this.connection) {
                this.connection.dispose()
                this.connection = null
            }

            this._onKilled.fire()

            for(const i of this.testRuns.values()) {
                i.testRun.end()
            }

            this.testFeature.testControllerTerminated()
        })

        this.process.on('error', (err: Error) => {
            handleNewCrashReportFromException(err, 'Extension')
            // this.launchError = err
        })
    }

    public async createTestRun(
        testRun: vscode.TestRun,
        mode: TestRunMode,
        maxProcessCount: number,
        all_the_tests: {testItem: vscode.TestItem, details: tlsp.TestItemDetail, testEnv: tlsp.GetTestEnvRequestParamsReturn}[],
        testSetups: {
            packageUri: string,
            name: string,
            kind: string,
            uri: string,
            line: number,
            column: number
            code: string
        }[]) {
        const nthreads = inferJuliaNumThreads()

        const juliaExec = await this.juliaExecutablesFeature.getActiveJuliaExecutableAsync()

        const testRunId = uuidv4()
        this.testRuns.set(testRunId, {
            testRun: testRun,
            testItems: new Map(all_the_tests.map(i=>[i.testItem.id, i.testItem]))
        })
        const params =  {
            testRunId: testRunId,
            testProfiles: [
                {
                    id: 'id1',
                    label: 'default',
                    juliaCmd: juliaExec.file,
                    juliaArgs: juliaExec.args,
                    juliaNumThreads: nthreads,
                    juliaEnv: {},
                    maxProcessCount: maxProcessCount,
                    mode: modeAsString(mode),
                    coverageRootUris: (mode !== TestRunMode.Coverage || !vscode.workspace.workspaceFolders) ? undefined : vscode.workspace.workspaceFolders.map(i=>i.uri.toString())
                }

            ],
            testItems: all_the_tests.map(i=>{
                return {
                    id: i.testItem.id,
                    uri: i.testItem.uri.toString(),
                    label: i.testItem.label,
                    ...i.testEnv,
                    useDefaultUsings: i.details.optionDefaultImports,
                    testSetups: i.details.optionSetup,
                    line: i.details.range.start.line + 1,
                    column: i.details.range.start.character + 1,
                    code: i.details.code,
                    codeLine: i.details.codeRange.start.line + 1,
                    codeColumn: i.details.codeRange.start.character + 1,
                }
            }),
            testSetups: testSetups,

        }

        const testrunResult = await this.connection.sendRequest(requestTypeCreateTestRun, params, testRun.token)

        if(testrunResult.coverage) {
            for(const file of testrunResult.coverage) {
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

        testRun.end()
        this.testRuns.delete(testRunId)
    }
}

// export class TestProcess {


//     private process: ChildProcessWithoutNullStreams
//     private connection: rpc.MessageConnection
//     public testRun: vscode.TestRun | null = null
//     public launchError: Error | null = null

//     private plannedKill = false

//     private _onKilled = new vscode.EventEmitter<void>()
//     public onKilled = this._onKilled.event

//     public project_uri: lsp.URI | null = null
//     public package_uri: lsp.URI | null = null
//     public packageName: string | null = null
//     public testEnvContentHash: number

//     public debugPipename: string = generatePipeName(uuid(), 'vsc-jl-td')
//     public activeDebugSession: vscode.DebugSession | null = null

//     constructor(public coverage: boolean) {}

//     isConnected() {
//         return this.connection
//     }

//     isBusy() {
//         return this.testRun!==null
//     }



//         const nthreads = inferJuliaNumThreads()

//         if (nthreads==='auto') {
//             jlArgs.push('--threads=auto')
//         }

//         const jlEnv = {
//             JULIA_REVISE: 'off'
//         }

//         if (nthreads!=='auto' && nthreads!=='') {
//             jlEnv['JULIA_NUM_THREADS'] = nthreads
//         }


//     stopDebugging() {
//         if(this.activeDebugSession) {
//             vscode.debug.stopDebugging(this.activeDebugSession)
//         }
//     }
// }

export class TestFeature {
    private controller: vscode.TestController
    private testitems: WeakMap<vscode.TestItem, tlsp.TestItemDetail> = new WeakMap<vscode.TestItem, tlsp.TestItemDetail>()
    private testsetups: Map<vscode.Uri,tlsp.TestSetupDetail[]> = new Map<vscode.Uri,tlsp.TestSetupDetail[]>()
    // public debugPipename2TestProcess: Map<string, TestProcess> = new Map<string, TestProcess>()
    // private outputChannel: vscode.OutputChannel
    // private someTestItemFinished = new Subject()
    private cpuLength: number | null = null
    private languageClient: vslc.LanguageClient = null

    private juliaTestitemControllerOutputChannel: vscode.OutputChannel | undefined = undefined
    public juliaTestProcessOutputChannels: Map<string,vscode.OutputChannel> = new Map()
    private juliaTestController: JuliaTestController = undefined

    constructor(private context: vscode.ExtensionContext, private executableFeature: JuliaExecutablesFeature, private workspaceFeature: WorkspaceFeature,private compiledProvider: DebugConfigTreeProvider) {
        // this.outputChannel = vscode.window.createOutputChannel('Julia Testserver')
        this.juliaTestitemControllerOutputChannel = vscode.window.createOutputChannel('Julia Test Item Controller')

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
            ),
            registerCommand('language-julia.stopTestController', (node: TestControllerNode) =>
                node.stop()
            )
        )

        // vscode.debug.onDidStartDebugSession((session: vscode.DebugSession) => {
        //     if(session.configuration.pipename && this.debugPipename2TestProcess.has(session.configuration.pipename)) {
        //         const testprocess = this.debugPipename2TestProcess.get(session.configuration.pipename)
        //         testprocess.activeDebugSession = session
        //     }
        // })

        // vscode.debug.onDidTerminateDebugSession((session: vscode.DebugSession) => {
        //     if(session.configuration.pipename && this.debugPipename2TestProcess.has(session.configuration.pipename)) {
        //         const testprocess = this.debugPipename2TestProcess.get(session.configuration.pipename)
        //         testprocess.activeDebugSession = null
        //     }
        // })

        this.cpuLength = cpus().length

        context.subscriptions.push(onSetLanguageClient(languageClient => {
            this.languageClient = languageClient
        }))
    }

    public publishTestsHandler(params: tlsp.PublishTestsParams) {
        const uri = vscode.Uri.parse(params.uri)

        const niceFilename = vscode.workspace.asRelativePath(uri.fsPath, false)
        const shortFilename = path.basename(niceFilename)
        const filenameParts = path.dirname(niceFilename).split('/')
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri)

        if(!workspaceFolder) {
            // Test file that is outside of the workspace, we skip
            return
        }

        if (params.testItemDetails.length > 0 || params.testErrorDetails.length > 0) {
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
                ...params.testItemDetails.map(i => {
                    const testitem = this.controller.createTestItem(i.id, i.label, uri)
                    testitem.tags = i.optionTags.map(j => new vscode.TestTag(j))
                    testitem.range = new vscode.Range(i.range.start.line, i.range.start.character, i.range.end.line, i.range.end.character)

                    this.testitems.set(testitem, i)

                    return testitem
                }),
                ...params.testErrorDetails.map(i => {
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

        this.testsetups.set(uri, params.testSetupDetails)
    }

    walkTestTree(item: vscode.TestItem, itemsToRun: vscode.TestItem[]) {
        if (this.testitems.has(item)) {
            itemsToRun.push(item)
        }
        else {
            item.children.forEach(i=>this.walkTestTree(i, itemsToRun))
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

    async ensureJuliaTestController() {
        if(!this.juliaTestController || !this.juliaTestController.ready()) {
            this.juliaTestController = new JuliaTestController(this, this.executableFeature, this.workspaceFeature, this.context, this.juliaTestitemControllerOutputChannel, this.compiledProvider)

            await this.juliaTestController.start()
        }
    }

    async testControllerTerminated() {
        this.juliaTestController = undefined
        for (const i of this.juliaTestProcessOutputChannels.values()) {
            i.dispose()
        }
    }

    async runHandler(
        request: vscode.TestRunRequest,
        mode: TestRunMode,
        token: vscode.CancellationToken
    ) {
        await this.ensureJuliaTestController()

        if(mode===TestRunMode.Coverage) {
            const ex = await this.executableFeature.getActiveJuliaExecutableAsync()
            if(ex.getVersion().compare('1.11.0-rc2')===-1) {
                vscode.window.showErrorMessage('Running tests with coverage requires Julia 1.11 or newer.')
                return
            }
        }

        if(token.isCancellationRequested) {
            return
        }

        const testRun = this.controller.createTestRun(request, undefined, true)

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
            if (i.error) {
                testRun.errored(i, new vscode.TestMessage(i.error))
            }
            else {
                testRun.enqueued(i)
            }
        }

        const uniqueFiles = new Set(itemsToRun.map(i=>i.uri).concat([...this.testsetups.keys()]))

        const testEnvPerFile = new Map<vscode.Uri,tlsp.GetTestEnvRequestParamsReturn>()

        for (const uri of uniqueFiles) {
            const testEnv = await this.languageClient.sendRequest(tlsp.requestTypJuliaGetTestEnv, {uri: uri.toString()})
            testEnvPerFile.set(uri, testEnv)
        }

        const all_the_tests = itemsToRun.map(i=>{
            return {
                testItem: i,
                details: this.testitems.get(i),
                testEnv: testEnvPerFile.get(i.uri)
            }
        })

        const all_the_testsetups: {
            packageUri: string,
            name: string,
            kind: string,
            uri: string,
            line: number,
            column: number,
            code: string
        }[] = []
        this.testsetups.forEach((setups, uri) => {
            setups.forEach(j=>{

                all_the_testsetups.push({
                    packageUri: testEnvPerFile.get(uri).packageUri,
                    name: j.name,
                    kind: j.kind,
                    uri: uri.toString(),
                    line: j.codeRange.start.line+1,
                    column: j.codeRange.start.character+1,
                    code: j.code
                }
                )
            })
        })

        let maxNumProcesses = vscode.workspace.getConfiguration('julia').get<number>('numTestProcesses')

        if(maxNumProcesses===0) {
            maxNumProcesses = this.cpuLength
        }

        if(token.isCancellationRequested) {
            testRun.end()
            return
        }

        await this.juliaTestController.createTestRun(testRun, mode, maxNumProcesses, all_the_tests, all_the_testsetups)




    }

    public dispose() {

    }
}
