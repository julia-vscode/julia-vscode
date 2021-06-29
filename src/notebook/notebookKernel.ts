import { exists } from 'async-file'
import { Subject } from 'await-notify'
import { ChildProcess, spawn } from 'child_process'
import * as net from 'net'
import * as path from 'path'
import { uuid } from 'uuidv4'
import * as vscode from 'vscode'
import { CancellationToken, createMessageConnection, MessageConnection, NotificationType, RequestType, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import { getAbsEnvPath } from '../jlpkgenv'
import { JuliaExecutable } from '../juliaexepath'
import { getCrashReportingPipename } from '../telemetry'
import { generatePipeName } from '../utils'
import { JuliaNotebookFeature } from './notebookFeature'

const notifyTypeDisplay = new NotificationType<{ items: { mimetype: string, data: string }[] }>('notebook/display')
const notifyTypeStreamoutput = new NotificationType<{ name: string, data: string }>('streamoutput')
const requestTypeRunCell = new RequestType<{ code: string }, { success: boolean, error: { message: string, name: string, stack: string } }, void>('notebook/runcell')

// function getDisplayPathName(pathValue: string): string {
//     return pathValue.startsWith(homedir()) ? `~${path.relative(homedir(), pathValue)}` : pathValue
// }

export class JuliaKernel {
    private _localDisposables: vscode.Disposable[] = []

    private _scheduledExecutionRequests: vscode.NotebookCellExecution[] = []
    private _currentExecutionRequest: vscode.NotebookCellExecution = null
    private _processExecutionRequests = new Subject()

    private _kernelProcess: ChildProcess
    public _msgConnection: MessageConnection;
    private _current_request_id: number = 0;

    private _onCellRunFinished = new vscode.EventEmitter<void>()
    public onCellRunFinished = this._onCellRunFinished.event

    private _onConnected = new vscode.EventEmitter<void>()
    public onConnected = this._onConnected.event

    private _onStopped = new vscode.EventEmitter<void>()
    public onStopped = this._onStopped.event

    private _tokenSource = new vscode.CancellationTokenSource()

    constructor(
        private extensionPath: string,
        public controller: vscode.NotebookController,
        public notebook: vscode.NotebookDocument,
        public juliaExecutable: JuliaExecutable,
        private outputChannel: vscode.OutputChannel,
        private notebookFeature: JuliaNotebookFeature
    ) {
        this.run(this._tokenSource.token)
    }

    public dispose() {
        this.stop()
        this._localDisposables.forEach(d => d.dispose())
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

    private async messageLoop(token: CancellationToken) {
        while (true) {
            if (token.isCancellationRequested) {
                return
            }

            while (this._scheduledExecutionRequests.length > 0) {
                this._currentExecutionRequest = this._scheduledExecutionRequests.shift()

                if (this._currentExecutionRequest.token.isCancellationRequested) {
                    this._currentExecutionRequest.end(undefined)
                }
                else {
                    const runStartTime = Date.now()
                    this._currentExecutionRequest.start(runStartTime)

                    // TODO Ideally we would clear output at scheduling already, but for now do it here
                    await this._currentExecutionRequest.clearOutput()

                    const result = await this._msgConnection.sendRequest(requestTypeRunCell, { code: this._currentExecutionRequest.cell.document.getText() })

                    if (!result.success) {
                        this._currentExecutionRequest.appendOutput(new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error(result.error)]))
                    }

                    const runEndTime = Date.now()
                    this._currentExecutionRequest.end(result.success, runEndTime)
                }
                this._currentExecutionRequest = null

                this._onCellRunFinished.fire()

                if (token.isCancellationRequested) {
                    return
                }
            }

            await this._processExecutionRequests.wait()
        }
    }

    private async containsJuliaEnv(folder: string) {
        return (await exists(path.join(folder, 'Project.toml')) && await exists(path.join(folder, 'Manifest.toml'))) ||
            (await exists(path.join(folder, 'JuliaProject.toml')) && await exists(path.join(folder, 'JuliaManifest.toml')))
    }

    private async getAbsEnvPathForNotebook() {
        if (this.notebook.isUntitled) {
            // We don't know the location of the notebook, so just use the default env
            return await getAbsEnvPath()
        }
        else {
            // First, figure out whether the notebook is in the workspace
            if (this.notebook.uri.scheme==='file' && vscode.workspace.getWorkspaceFolder(this.notebook.uri) !== undefined) {
                let currentFolder = path.dirname(this.notebook.uri.fsPath)

                // We run this loop until we are looking at a folder that is no longer part of the workspace
                while (vscode.workspace.getWorkspaceFolder(vscode.Uri.file(currentFolder)) !== undefined) {
                    if (await this.containsJuliaEnv(currentFolder)) {
                        return currentFolder
                    }

                    currentFolder = path.normalize(path.join(currentFolder, '..'))
                }

                // We did not find anything in the workspace, so return default
                return await getAbsEnvPath()
            }
            else {
                // Notebook is not inside the workspace, so just use the default env
                return await getAbsEnvPath()
            }
        }
    }

    private async run(token: CancellationToken) {
        const connectedPromise = new Subject()
        const serverListeningPromise = new Subject()

        const pn = generatePipeName(uuid(), 'vscjl-nbk')

        const server = net.createServer(socket => {
            this._msgConnection = createMessageConnection(
                new StreamMessageReader(socket),
                new StreamMessageWriter(socket)
            )

            this._msgConnection.onNotification(notifyTypeDisplay, ({ items }) => {
                const execution = this._currentExecutionRequest
                if (execution) {
                    execution.appendOutput(new vscode.NotebookCellOutput(items.map(item => {
                        if (item.mimetype == 'image/png' || item.mimetype == 'image/jpeg') {
                            return new vscode.NotebookCellOutputItem(Buffer.from(item.data, 'base64'), item.mimetype)
                        }
                        else {
                            return vscode.NotebookCellOutputItem.text(item.data, item.mimetype)
                        }
                    })))
                }
            })

            this._msgConnection.onNotification(notifyTypeStreamoutput, ({ name, data }) => {
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

        const pkgenvpath = await this.getAbsEnvPathForNotebook()

        this._kernelProcess = spawn(
            this.juliaExecutable.path,
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

        const outputChannel = this.outputChannel

        this._kernelProcess.stdout.on('data', function (data) {
            outputChannel.append(String(data))
        })
        this._kernelProcess.stderr.on('data', function (data) {
            outputChannel.append(String(data))
        })
        const tokenSource = this._tokenSource
        const processExecutionRequests = this._processExecutionRequests

        this._kernelProcess.on('close', async function (code) {
            tokenSource.cancel()
            processExecutionRequests.notify()

            this._terminal = undefined
            outputChannel.appendLine('Kernel closed.')
        })

        await connectedPromise.wait()

        await this.messageLoop(token)

        this._onStopped.fire(undefined)

        this.dispose()
    }

    public async stop() {
        if (this._kernelProcess) {
            this._kernelProcess.kill()
            this._kernelProcess = undefined
        }
    }

    public async restart() {
        this.notebookFeature.restart(this)
    }
}
