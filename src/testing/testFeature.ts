import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { uuid } from 'uuidv4'
import * as vscode from 'vscode'
import { NotificationType, RequestType } from 'vscode-jsonrpc'
import * as lsp from 'vscode-languageserver-protocol'
import { generatePipeName, inferJuliaNumThreads, registerNonAsyncCommand } from '../utils'
import * as net from 'net'
import * as rpc from 'vscode-jsonrpc/node'
import { Subject } from 'await-notify'
import { JuliaExecutablesFeature } from '../juliaexepath'
import { join } from 'path'
import { getCrashReportingPipename, handleNewCrashReportFromException } from '../telemetry'
import { getAbsEnvPath } from '../jlpkgenv'
import { TestProcessNode, WorkspaceFeature } from '../interactive/workspace'
import { cpus } from 'os'

interface TestItemDetail {
    id: string,
    label: string
    range: lsp.Range
    code?: string
    code_range?: lsp.Range
    option_default_imports?: boolean
    option_tags?: string[]
    error?: string
}

interface PublishTestItemsParams {
    uri: lsp.URI
    version: number,
    project_path: string,
    package_path: string,
    package_name: string,
    testitemdetails: TestItemDetail[]
}

interface TestserverRunTestitemRequestParams {
    uri: string
    name: string
    packageName: string
    useDefaultUsings: boolean
    line: number
    column: number
    code: string
}

interface TestMessage {
    message: string
    location: lsp.Location
}
interface TestserverRunTestitemRequestParamsReturn {
    status: string
    message: TestMessage[] | null,
    duration: number | null
}

export const notifyTypeTextDocumentPublishTestitems = new NotificationType<PublishTestItemsParams>('julia/publishTestitems')
const requestTypeExecuteTestitem = new RequestType<TestserverRunTestitemRequestParams, TestserverRunTestitemRequestParamsReturn, void>('testserver/runtestitem')
const requestTypeRevise = new RequestType<void, string, void>('testserver/revise')

export class TestProcess {

    private process: ChildProcessWithoutNullStreams
    private connection: lsp.MessageConnection
    public testRun: vscode.TestRun | null = null
    public launchError: Error | null = null

    private plannedKill = false

    private _onKilled = new vscode.EventEmitter<void>()
    public onKilled = this._onKilled.event

    public projectPath: string | null = null
    public packagePath: string | null = null
    public packageName: string | null = null

    isConnected() {
        return this.connection
    }

    isBusy() {
        return this.testRun!==null
    }

    public async start(context: vscode.ExtensionContext, juliaExecutablesFeature: JuliaExecutablesFeature, outputChannel: vscode.OutputChannel, projectPath: string, packagePath: string, packageName: string) {
        this.projectPath = projectPath
        this.packagePath = packagePath
        this.packageName = packageName

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
                join(context.extensionPath, 'scripts', 'testserver', 'testserver_main.jl'),
                pipename,
                `v:${projectPath}`,
                `v:${packagePath}`,
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

        this.process.on('error', async (err: Error) => {
            connected.notify()
            await handleNewCrashReportFromException(err, 'Extension')
            this.launchError = err
        })

        console.log(this.process.killed)

        await connected.wait()

        console.log('OK')
    }

    public async revise() {
        return await this.connection.sendRequest(requestTypeRevise, undefined)
    }

    public kill() {
        this.plannedKill = true
        this.process.kill()
    }


    public async executeTest(testItem: vscode.TestItem, packageName: string, useDefaultUsings: boolean, location: lsp.Location, code: string, testRun: vscode.TestRun, someTestItemFinished: Subject) {
        this.testRun = testRun

        try {
            const result = await this.connection.sendRequest(requestTypeExecuteTestitem, { uri: location.uri, name: testItem.label, packageName: packageName, useDefaultUsings: useDefaultUsings, line: location.range.start.line, column: location.range.start.character, code: code })

            if (result.status === 'passed') {
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
}

export class TestFeature {
    private controller: vscode.TestController
    private testitems: WeakMap<vscode.TestItem, { testitem: TestItemDetail, projectPath: string, packagePath: string, packageName: string }> = new WeakMap<vscode.TestItem, { testitem: TestItemDetail, projectPath: string, packagePath: string, packageName: string }>()
    private testProcesses: Map<string, TestProcess[]> = new Map<string, TestProcess[]>()
    private outputChannel: vscode.OutputChannel
    private someTestItemFinished = new Subject()
    private cpuLength: number | null = null

    constructor(private context: vscode.ExtensionContext, private executableFeature: JuliaExecutablesFeature, private workspaceFeature: WorkspaceFeature) {
        try {
            this.outputChannel = vscode.window.createOutputChannel('Julia Testserver')

            this.controller = vscode.tests.createTestController(
                'juliaTests',
                'Julia Tests'
            )

            this.controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, async (request, token) => {
                try {
                    await this.runHandler(request, token)
                }
                catch (err) {
                    await handleNewCrashReportFromException(err, 'Extension')
                    throw (err)
                }
            }, true)

            context.subscriptions.push(
                registerNonAsyncCommand('language-julia.stopTestProcess', (node: TestProcessNode) =>
                    node.stop()
                )
            )

            this.cpuLength = cpus().length
        // this.controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, this.runHandler.bind(this), false)
        // this.controller.createRunProfile('Coverage', vscode.TestRunProfileKind.Coverage, this.runHandler.bind(this), false)
        }
        catch (err) {
            // TODO Is missing await here ok?
            void handleNewCrashReportFromException(err, 'Extension')
            throw (err)
        }
    }

    public publishTestitemsHandler(params: PublishTestItemsParams) {
        const uri = vscode.Uri.parse(params.uri)

        let fileTestitem = this.controller.items.get(params.uri)

        if (!fileTestitem && params.testitemdetails.length > 0) {
            const filename = vscode.workspace.asRelativePath(uri.fsPath)

            fileTestitem = this.controller.createTestItem(params.uri, filename, uri)
            this.controller.items.add(fileTestitem)
        }
        else if (fileTestitem && params.testitemdetails.length === 0) {
            this.controller.items.delete(fileTestitem.id)
        }

        if (params.testitemdetails.length > 0 ) {
            fileTestitem.children.replace(params.testitemdetails.map(i => {
                const testitem = this.controller.createTestItem(i.id, i.label, vscode.Uri.parse(params.uri))
                if (i.error) {
                    testitem.error = i.error
                }
                else if (params.package_path==='') {
                    testitem.error = 'Unable to identify a Julia package for this test item.'
                }
                else {
                    testitem.tags = i.option_tags.map(j => new vscode.TestTag(j))
                }
                this.testitems.set(testitem, {testitem: i, projectPath: params.project_path, packagePath: params.package_path, packageName: params.package_name})
                testitem.range = new vscode.Range(i.range.start.line, i.range.start.character, i.range.end.line, i.range.end.character)

                return testitem
            }))
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

    async launchNewProcess(details: { testitem: TestItemDetail, projectPath: string, packagePath: string, packageName: string }) {
        const testProcess = new TestProcess()
        await testProcess.start(this.context, this.executableFeature, this.outputChannel, details.projectPath, details.packagePath, details.packageName)
        this.workspaceFeature.addTestProcess(testProcess)

        if(!this.testProcesses.has(JSON.stringify({projectPath: details.projectPath, packagePath: details.packagePath, packageName: details.packageName}))) {
            this.testProcesses.set(JSON.stringify({projectPath: details.projectPath, packagePath: details.packagePath, packageName: details.packageName}), [])
        }

        const processes = this.testProcesses.get(JSON.stringify({projectPath: details.projectPath, packagePath: details.packagePath, packageName: details.packageName}))

        processes.push(testProcess)

        testProcess.onKilled((e) => {
            processes.splice(processes.indexOf(testProcess))
        })

        return testProcess
    }

    async getFreeTestProcess(details: { testitem: TestItemDetail, projectPath: string, packagePath: string, packageName: string }) {
        if(!this.testProcesses.has(JSON.stringify({projectPath: details.projectPath, packagePath: details.packagePath, packageName: details.packageName}))) {
            const testProcess = await this.launchNewProcess(details)

            return testProcess
        }
        else {
            const testProcesses = this.testProcesses.get(JSON.stringify({projectPath: details.projectPath, packagePath: details.packagePath, packageName: details.packageName}))

            for(let testProcess of testProcesses) {
                if(!testProcess.isBusy()) {
                    let needsNewProcess = false

                    if (!testProcess.isConnected()) {
                        needsNewProcess = true
                    }
                    else {
                        const status = await testProcess.revise()

                        if (status !== 'success') {
                            testProcess.kill()

                            this.outputChannel.appendLine('RESTARTING TEST SERVER')

                            needsNewProcess = true
                        }

                    }

                    if (needsNewProcess) {
                        testProcess = await this.launchNewProcess(details)
                    }

                    return testProcess
                }
            }

            let maxNumProcesses = vscode.workspace.getConfiguration('julia').get<number>('numTestProcesses')

            if(maxNumProcesses===0) {
                maxNumProcesses = this.cpuLength
            }

            if(testProcesses.length < maxNumProcesses) {
                const testProcess = await this.launchNewProcess(details)

                return testProcess
            }
            else {
                return null
            }

        }
    }

    async runHandler(
        request: vscode.TestRunRequest,
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

                        let testProcess: TestProcess = await this.getFreeTestProcess(details)

                        while(testProcess===null && !testRun.token.isCancellationRequested) {
                            await this.someTestItemFinished.wait()
                            testProcess = await this.getFreeTestProcess(details)
                        }

                        if(testProcess!==null) {

                            testRun.started(i)

                            if(testProcess.isConnected()) {

                                const code = details.testitem.code

                                const location = {
                                    uri: i.uri.toString(),
                                    range: details.testitem.code_range
                                }

                                const executionPromise = testProcess.executeTest(i, details.packageName, details.testitem.option_default_imports, location, code, testRun, this.someTestItemFinished)

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
        }
        finally {
            testRun.end()
        }
    }

    public dispose() {

    }
}
