import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { uuid } from 'uuidv4'
import * as vscode from 'vscode'
import { NotificationType, RequestType } from 'vscode-jsonrpc'
import * as lsp from 'vscode-languageserver-protocol'
import { generatePipeName } from '../utils'
import * as net from 'net'
import * as rpc from 'vscode-jsonrpc/node'
import { Subject } from 'await-notify'
import { JuliaExecutablesFeature } from '../juliaexepath'
import { join } from 'path'
import { getCrashReportingPipename } from '../telemetry'
import { getAbsEnvPath } from '../jlpkgenv'

interface Testitem {
    name: string
    range: lsp.Range
}

interface PublishTestitemsParams {
    uri: lsp.URI
    version: number
    testitems: Testitem[]
}

interface TestserverRunTestitemRequestParams {
    uri: string
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
    message: TestMessage[] | null
}

export const notifyTypeTextDocumentPublishTestitems = new NotificationType<PublishTestitemsParams>('julia/publishTestitems')
const requestTypeExecuteTestitem = new RequestType<TestserverRunTestitemRequestParams, TestserverRunTestitemRequestParamsReturn, void>('testserver/runtestitem')
const requestTypeRevise = new RequestType<void, string, void>('testserver/revise')

class TestProcess {
    private process: ChildProcessWithoutNullStreams
    private connection: lsp.MessageConnection
    private testRun: vscode.TestRun

    public async start(context: vscode.ExtensionContext, juliaExecutablesFeature: JuliaExecutablesFeature, outputChannel: vscode.OutputChannel) {
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

        this.process = spawn(
            juliaExecutable.file,
            [
                ...juliaExecutable.args,
                `--project=${pkgenvpath}`,
                join(context.extensionPath, 'scripts', 'testserver', 'testserver_main.jl'),
                pipename,
                getCrashReportingPipename()
            ],
            {
                env: {
                    JULIA_REVISE: 'off'
                }
            }
        )

        this.process.stdout.on('data', data => {
            if (this.testRun) {
                this.testRun.appendOutput(String(data).split('\n').join('\n\r'))
            }
            else {
                outputChannel.append(String(data))
            }
        })

        this.process.stderr.on('data', data => {
            if (this.testRun) {
                this.testRun.appendOutput(String(data).split('\n').join('\n\r'))
            }
            else {
                outputChannel.append(String(data))
            }
        })


        console.log(this.process.killed)

        await connected.wait()

        console.log('OK')
    }

    public async revise() {
        return await this.connection.sendRequest(requestTypeRevise, undefined)
    }

    public async kill() {
        this.process.kill()
    }


    public async executeTest(location: lsp.Location, code: string, testRun: vscode.TestRun) {
        this.testRun = testRun
        const result = await this.connection.sendRequest(requestTypeExecuteTestitem, { uri: location.uri, line: location.range.start.line, column: location.range.start.character, code: code })
        this.testRun = undefined
        return result
    }
}
export class TestFeature {
    private controller: vscode.TestController
    private testitems: WeakMap<vscode.TestItem, Testitem> = new WeakMap<vscode.TestItem, Testitem>()
    private testProcess: TestProcess = null
    private outputChannel: vscode.OutputChannel

    constructor(private context: vscode.ExtensionContext, private executableFeature: JuliaExecutablesFeature) {
        console.log(this.context.extensionUri)

        this.outputChannel = vscode.window.createOutputChannel('Julia Testserver')

        this.controller = vscode.tests.createTestController(
            'juliaTests',
            'Julia Tests'
        )

        this.controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, async (request, token) => await this.runHandler(request, token), true)
        // this.controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, this.runHandler.bind(this), false)
        // this.controller.createRunProfile('Coverage', vscode.TestRunProfileKind.Coverage, this.runHandler.bind(this), false)

    }

    public publishTestitemsHandler(params: PublishTestitemsParams) {
        const uri = vscode.Uri.parse(params.uri)

        let fileTestitem = this.controller.items.get(params.uri)

        if (!fileTestitem) {
            const filename = vscode.workspace.asRelativePath(uri.fsPath)

            fileTestitem = this.controller.createTestItem(params.uri, filename, uri)
            this.controller.items.add(fileTestitem)
        }

        fileTestitem.children.replace(params.testitems.map(i => {
            const testitem = this.controller.createTestItem(i.name, i.name, vscode.Uri.parse(params.uri))
            this.testitems.set(testitem, i)
            testitem.range = new vscode.Range(i.range.start.line, i.range.start.character, i.range.end.line, i.range.end.character)

            return testitem
        }))
    }

    walkTestTree(item: vscode.TestItem, itemsToRun: vscode.TestItem[]) {
        if (this.testitems.has(item)) {
            itemsToRun.push(item)
        }
        else {
            item.children.forEach(i=>this.walkTestTree(i, itemsToRun))
        }
    }

    async runHandler(
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken
    ) {
        const testRun = this.controller.createTestRun(request, undefined, true)

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

        if (this.testProcess === null) {
            this.testProcess = new TestProcess()
            await this.testProcess.start(this.context, this.executableFeature, this.outputChannel)
        }
        else {
            const status = await this.testProcess.revise()

            if (status !== 'success') {
                await this.testProcess.kill()

                this.outputChannel.appendLine('RESTARTING TEST SERVER')

                this.testProcess = new TestProcess()
                await this.testProcess.start(this.context, this.executableFeature, this.outputChannel)
            }
        }

        for (const i of itemsToRun) {
            testRun.started(i)

            const details = this.testitems.get(i)

            const doc = await vscode.workspace.openTextDocument(i.uri)

            const code = doc.getText(new vscode.Range(details.range.start.line, details.range.start.character, details.range.end.line, details.range.end.character))

            const location = {
                uri: i.uri.toString(),
                range: details.range
            }

            const result = await this.testProcess.executeTest(location, code, testRun)

            if (result.status === 'passed') {

                testRun.passed(i)
            }
            else if (result.status === 'errored') {
                const message = new vscode.TestMessage(result.message[0].message)
                message.location = new vscode.Location(vscode.Uri.parse(result.message[0].location.uri), new vscode.Position(result.message[0].location.range.start.line, result.message[0].location.range.start.character))
                testRun.errored(i, message)
            }
            else if (result.status === 'failed') {
                const messages = result.message.map(i => {
                    const message = new vscode.TestMessage(i.message)
                    message.location = new vscode.Location(vscode.Uri.parse(i.location.uri), new vscode.Position(i.location.range.start.line, i.location.range.start.character))
                    return message
                })
                testRun.errored(i, messages)
            }
        }

        // testRun.failed(this.controller.items.get('test1'), new vscode.TestMessage('Well that did not work'))

        testRun.end()
    }

    public dispose() {

    }
}
