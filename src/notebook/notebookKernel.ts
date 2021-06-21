import { Subject } from 'await-notify'
import { ChildProcess, spawn } from 'child_process'
import * as net from 'net'
import { homedir } from 'os'
import * as path from 'path'
import { uuid } from 'uuidv4'
import * as vscode from 'vscode'
import { createMessageConnection, MessageConnection, NotificationType, RequestType, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import { getAbsEnvPath } from '../jlpkgenv'
import { getJuliaExePath } from '../juliaexepath'
import { getCrashReportingPipename } from '../telemetry'
import { generatePipeName } from '../utils'

const notifyTypeDisplay = new NotificationType<{ mimetype: string, current_request_id: number, data: string }>('notebook/display')
const notifyTypeStreamoutput = new NotificationType<{ name: string, current_request_id: number, data: string }>('streamoutput')
const requestTypeRunCell = new RequestType<{ current_request_id: number, code: string }, { success: boolean, error: { message: string, name: string, stack: string } }, void>('notebook/runcell')

function getDisplayPathName(pathValue: string): string {
    return pathValue.startsWith(homedir()) ? `~${path.relative(homedir(), pathValue)}` : pathValue
}

export class JuliaKernel {
    private _localDisposables: vscode.Disposable[] = []

    private _scheduledExecutionRequests: vscode.NotebookCellExecution[] = []
    private _currentExecutionRequest: vscode.NotebookCellExecution = null
    private _processExecutionRequests = new Subject()

    private _kernelProcess: ChildProcess
    public _msgConnection: MessageConnection;
    private _current_request_id: number = 0;

    private _outputChannel: vscode.OutputChannel

    private _onCellRunFinished = new vscode.EventEmitter<void>()
    public onCellRunFinished = this._onCellRunFinished.event

    private _onConnected = new vscode.EventEmitter<void>()
    public onConnected = this._onConnected.event

    constructor(private extensionPath: string, private controller: vscode.NotebookController, public notebook: vscode.NotebookDocument) {
        this._outputChannel = vscode.window.createOutputChannel(`Julia Notebook Kernel ${getDisplayPathName(this.notebook.uri.fsPath)}`)
    }

    public dispose() {
        this._localDisposables.forEach(d => d.dispose())
        this.stop()
    }

    public async queueCell(cell: vscode.NotebookCell): Promise<void> {
        const executionOrder = ++this._current_request_id

        const execution = this.controller.createNotebookCellExecution(cell)
        execution.executionOrder = executionOrder

        // TODO For some reason this doesn't work here
        // await execution.clearOutput()

        this._scheduledExecutionRequests.push(execution)

        this._processExecutionRequests.notify()
    }

    private async processExecutions() {
        while (true) {
            await this._processExecutionRequests.wait()

            while (this._scheduledExecutionRequests.length > 0) {
                this._currentExecutionRequest = this._scheduledExecutionRequests.shift()

                const runStartTime = Date.now()
                this._currentExecutionRequest.start(runStartTime)

                // TODO Ideally we would clear output at scheduling already, but for now do it here
                await this._currentExecutionRequest.clearOutput()

                const result = await this._msgConnection.sendRequest(requestTypeRunCell, { current_request_id: this._currentExecutionRequest.executionOrder, code: this._currentExecutionRequest.cell.document.getText() })

                if (!result.success) {
                    this._currentExecutionRequest.appendOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(result.error)]))
                }

                const runEndTime = Date.now()
                this._currentExecutionRequest.end(result.success, runEndTime)



                this._currentExecutionRequest = null

                this._onCellRunFinished.fire()
            }
        }
    }

    public async start() {
        if (!this._kernelProcess) {
            this._current_request_id = 0
            const connectedPromise = new Subject()
            const serverListeningPromise = new Subject()

            const pn = generatePipeName(uuid(), 'vscjl-nbk')

            const server = net.createServer(socket => {
                this._msgConnection = createMessageConnection(
                    new StreamMessageReader(socket),
                    new StreamMessageWriter(socket)
                )

                // this._msgConnection.onNotification(notifyTypeRunCellFailed, ({ request_id, output }) => {
                //     const runEndTime = Date.now()

                //     const request = this.executionRequests.get(request_id)
                //     const execution = this.cellExecutions.get(request.execution.cell)
                //     if (execution) {
                //
                //         execution.end(false, runEndTime)
                //     }
                //     this._onCellRunFinished.fire()
                // })

                this._msgConnection.onNotification(notifyTypeDisplay, ({ mimetype, current_request_id, data }) => {
                    const execution = this._currentExecutionRequest
                    if (execution) {
                        execution.appendOutput(new vscode.NotebookCellOutput([new vscode.NotebookCellOutputItem(Buffer.from(data), mimetype)]))
                    }
                })

                this._msgConnection.onNotification(notifyTypeStreamoutput, ({ name, current_request_id, data }) => {
                    if (name === 'stdout') {
                        const execution = this._currentExecutionRequest
                        if (execution) {
                            execution.appendOutput([new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stdout(data)])])
                        }
                    }
                    else if (name === 'stderr') {
                        const execution = this._currentExecutionRequest
                        if (execution) {
                            execution.appendOutput([new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stdout(data)])])
                        }
                    }
                    else {
                        throw (new Error('Unknown stream type.'))
                    }
                })

                this._msgConnection.listen()

                this._onConnected.fire(null)

                connectedPromise.notify()
            })

            server.listen(pn, () => {
                serverListeningPromise.notify()
            })

            await serverListeningPromise.wait()

            const jlexepath = await getJuliaExePath()
            const pkgenvpath = await getAbsEnvPath()

            this._kernelProcess = spawn(
                jlexepath,
                [
                    '--color=yes',
                    `--project=${pkgenvpath}`,
                    '--startup-file=no',
                    '--history-file=no',
                    path.join(this.extensionPath, 'scripts', 'notebook', 'notebook.jl'),
                    pn,
                    getCrashReportingPipename()
                ]
            )

            const outputChannel = this._outputChannel

            this._kernelProcess.stdout.on('data', function (data) {
                outputChannel.append(String(data))
            })
            this._kernelProcess.stderr.on('data', function (data) {
                outputChannel.append(String(data))
            })
            this._kernelProcess.on('close', async function (code) {
                this._terminal = undefined
                outputChannel.appendLine('Kernel closed.')
            })

            await connectedPromise.wait()

            this.processExecutions()

            console.log('Hello')
        }
    }

    public async restart() {
        await this.stop()
        await this.start()
    }

    public async stop() {

        if (this._kernelProcess) {
            this._kernelProcess.kill()
            this._kernelProcess = undefined
        }
    }
}
