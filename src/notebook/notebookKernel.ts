import { exists } from 'async-file'
import { Subject } from 'await-notify'
import { ChildProcess, spawn } from 'child_process'
import * as net from 'net'
import * as path from 'path'
import { uuid } from 'uuidv4'
import * as vscode from 'vscode'
import {
    CancellationToken,
    createMessageConnection,
    MessageConnection,
    NotificationType,
    RequestType,
    StreamMessageReader,
    StreamMessageWriter
} from 'vscode-jsonrpc/node'
import { getAbsEnvPath } from '../jlpkgenv'
import { JuliaExecutable } from '../juliaexepath'
import { getCrashReportingPipename, handleNewCrashReportFromException } from '../telemetry'
import { generatePipeName, inferJuliaNumThreads } from '../utils'
import { JuliaNotebookFeature } from './notebookFeature'

const notifyTypeDisplay = new NotificationType<{
    items: { mimetype: string; data: string }[]
}>('notebook/display')
const notifyTypeStreamoutput = new NotificationType<{
    name: string
    data: string
}>('streamoutput')
const requestTypeRunCell = new RequestType<
    { filename: string; line: number; column: number; code: string },
    { success: boolean; error: { message: string; name: string; stack: string } },
    void
>('notebook/runcell')

// function getDisplayPathName(pathValue: string): string {
//     return pathValue.startsWith(homedir()) ? `~${path.relative(homedir(), pathValue)}` : pathValue
// }

export class JuliaKernel {
    private _localDisposables: vscode.Disposable[] = []

    private _scheduledExecutionRequests: vscode.NotebookCellExecution[] = []
    private _currentExecutionRequest: vscode.NotebookCellExecution = null
    private _processExecutionRequests = new Subject()

    private _kernelProcess: ChildProcess
    public _msgConnection: MessageConnection
    private _current_request_id: number = 0

    private _onCellRunFinished = new vscode.EventEmitter<void>()
    public onCellRunFinished = this._onCellRunFinished.event

    private _onConnected = new vscode.EventEmitter<void>()
    public onConnected = this._onConnected.event

    private _onStopped = new vscode.EventEmitter<void>()
    public onStopped = this._onStopped.event

    private _tokenSource = new vscode.CancellationTokenSource()

    private debuggerPipename: string | null
    public activeDebugSession: vscode.DebugSession | null

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
        this._localDisposables.forEach((d) => d.dispose())
    }

    public mapCellToPath(uri: string) {
        const cellUri = vscode.Uri.parse(uri, true)

        // find cell in document by matching its URI
        const cell = this.notebook.getCells().find(c => c.document.uri.toString() === uri)

        const cellPath = path.join(path.dirname(cellUri.fsPath), `jl_notebook_cell_df34fa98e69747e1a8f8a730347b8e2f_${cellUri.fragment}.jl`)

        this.notebookFeature.pathToCell.set(cellPath, cell)

        return cellPath
    }

    public async queueCell(cell: vscode.NotebookCell): Promise<void> {
        // First clear output
        const clearOutputExecution =
            this.controller.createNotebookCellExecution(cell)
        clearOutputExecution.start()
        await clearOutputExecution.clearOutput()
        clearOutputExecution.end(undefined)

        // Now create execution object that actually will run the code
        const execution = this.controller.createNotebookCellExecution(cell)
        execution.token.onCancellationRequested((e) => {
            execution.end(undefined)
            this.interrupt()
        })
        this._scheduledExecutionRequests.push(execution)

        this._processExecutionRequests.notify()
    }

    private async messageLoop(token: CancellationToken) {
        while (true) {
            if (token.isCancellationRequested) {
                return
            }

            while (this._scheduledExecutionRequests.length > 0) {
                this._currentExecutionRequest =
                    this._scheduledExecutionRequests.shift()

                if (this._currentExecutionRequest.token.isCancellationRequested) {
                    console.log('this is cancelled')
                } else {
                    const executionOrder = ++this._current_request_id
                    this._currentExecutionRequest.executionOrder = executionOrder

                    const cellPath = this.mapCellToPath(this._currentExecutionRequest.cell.document.uri.toString())

                    const runStartTime = Date.now()
                    this._currentExecutionRequest.start(runStartTime)

                    const result = await this._msgConnection.sendRequest(
                        requestTypeRunCell,
                        {
                            filename: cellPath,
                            line: 0,
                            column: 0,
                            code: this._currentExecutionRequest.cell.document.getText(),
                        }
                    )

                    if (!result.success) {
                        this._currentExecutionRequest.appendOutput(
                            new vscode.NotebookCellOutput([
                                vscode.NotebookCellOutputItem.error(result.error),
                            ])
                        )
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

    async toggleDebugging() {
        if(this.activeDebugSession) {
            vscode.debug.stopDebugging(this.activeDebugSession)
        }
        else {
            await vscode.debug.startDebugging(undefined, {
                type: 'julia',
                request: 'attach',
                name: 'Julia Notebook',
                pipename: this.debuggerPipename,
                stopOnEntry: false
                // compiledModulesOrFunctions: g_compiledProvider.getCompiledItems(),
                // compiledMode: g_compiledProvider.compiledMode
            })
        }
    }

    private async containsJuliaEnv(folder: string) {
        return (
            ((await exists(path.join(folder, 'Project.toml'))) &&
                (await exists(path.join(folder, 'Manifest.toml')))) ||
            ((await exists(path.join(folder, 'JuliaProject.toml'))) &&
                (await exists(path.join(folder, 'JuliaManifest.toml'))))
        )
    }

    private async getAbsEnvPathForNotebook() {
        if (this.notebook.isUntitled) {
            // We don't know the location of the notebook, so just use the default env
            return await getAbsEnvPath()
        } else {
            // First, figure out whether the notebook is in the workspace
            if (
                this.notebook.uri.scheme === 'file' &&
                vscode.workspace.getWorkspaceFolder(this.notebook.uri) !== undefined
            ) {
                let currentFolder = path.dirname(vscode.Uri.parse(this.notebook.uri.toString()).fsPath)

                // We run this loop until we are looking at a folder that is no longer part of the workspace
                while (
                    vscode.workspace.getWorkspaceFolder(
                        vscode.Uri.file(currentFolder)
                    ) !== undefined
                ) {
                    if (await this.containsJuliaEnv(currentFolder)) {
                        return currentFolder
                    }

                    currentFolder = path.normalize(path.join(currentFolder, '..'))
                }

                // We did not find anything in the workspace, so return default
                return await getAbsEnvPath()
            } else {
                // Notebook is not inside the workspace, so just use the default env
                return await getAbsEnvPath()
            }
        }
    }

    private async getCwdPathForNotebook() {
        if (this.notebook.isUntitled) {
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                return vscode.workspace.workspaceFolders[0].uri.fsPath
            } else {
                return await this.getAbsEnvPathForNotebook()
            }
        }

        if (this.notebook.uri.scheme === 'file') {
            return path.dirname(this.notebook.uri.fsPath)
        } else {
            return await getAbsEnvPath()
        }
    }

    private async run(token: CancellationToken) {
        try {
            const connectedPromise = new Subject()
            const serverListeningPromise = new Subject()

            const pn = generatePipeName(uuid(), 'vscjl-nbk')

            const server = net.createServer((socket) => {
                this._msgConnection = createMessageConnection(
                    new StreamMessageReader(socket),
                    new StreamMessageWriter(socket)
                )

                this._msgConnection.onNotification(notifyTypeDisplay, ({ items }) => {
                    const execution = this._currentExecutionRequest
                    if (execution) {
                        execution.appendOutput(
                            new vscode.NotebookCellOutput(
                                items.map((item) => {
                                    if (
                                        item.mimetype === 'image/png' ||
                                        item.mimetype === 'image/jpeg'
                                    ) {
                                        return new vscode.NotebookCellOutputItem(
                                            Buffer.from(item.data, 'base64'),
                                            item.mimetype
                                        )
                                    } else if (item.mimetype.endsWith('+json')) {
                                        return vscode.NotebookCellOutputItem.json(
                                            item.data,
                                            item.mimetype
                                        )
                                    } else {
                                        return vscode.NotebookCellOutputItem.text(
                                            item.data,
                                            item.mimetype
                                        )
                                    }
                                })
                            )
                        )
                    }
                })

                const outputsPerExecution = new WeakMap<vscode.NotebookCellExecution,{output: vscode.NotebookCellOutput | undefined, name: 'stdout' |'stderr'}>()
                this._msgConnection.onNotification(
                    notifyTypeStreamoutput,
                    ({ name, data }) => {
                        const execution = this._currentExecutionRequest
                        if (!execution) {
                            return
                        }
                        if (name === 'stdout' || name === 'stderr') {
                            // Ensure \r is in a seprate line.
                            data.split(/(\r)/).forEach((line) => {
                                const previousOutput = outputsPerExecution.get(this._currentExecutionRequest)
                                if (previousOutput?.name === name) {
                                    execution.appendOutputItems([vscode.NotebookCellOutputItem[name](line)], previousOutput.output)
                                } else {
                                    const output = new vscode.NotebookCellOutput([
                                        vscode.NotebookCellOutputItem[name](line),
                                    ])
                                    execution.appendOutput([output])
                                    outputsPerExecution.set(this._currentExecutionRequest, {output, name})
                                }
                            })
                        } else {
                            throw new Error('Unknown stream type.')
                        }
                    }
                )

                this._msgConnection.listen()

                this._onConnected.fire(null)

                connectedPromise.notify()
            })

            server.listen(pn, () => {
                serverListeningPromise.notify()
            })

            this.outputChannel.appendLine(`Pre 'await serverListeningPromise.wait()'`)
            await serverListeningPromise.wait()
            this.outputChannel.appendLine(`Post 'await serverListeningPromise.wait()'`)

            const pkgenvpath = await this.getAbsEnvPathForNotebook()
            this.outputChannel.appendLine(`Post 'const pkgenvpath = await this.getAbsEnvPathForNotebook()'`)
            const cwdPath = await this.getCwdPathForNotebook()
            this.outputChannel.appendLine(`Post 'const cwdPath = await this.getCwdPathForNotebook()'`)

            const nthreads = inferJuliaNumThreads()

            const args = [
                '--color=yes',
                `--project=${pkgenvpath}`,
                '--history-file=no',
            ]

            const env = {
                ...process.env
            }

            if (nthreads === 'auto') {
                args.push('--threads=auto')
            } else {
                env['JULIA_NUM_THREADS'] = nthreads
            }

            this.outputChannel.appendLine(`Now starting the kernel process from the extension with '${this.juliaExecutable.file}', '${args}'.`)

            this.debuggerPipename = generatePipeName(uuid(), 'vsc-jl-repldbg')

            this.notebookFeature.debugPipenameToKernel.set(this.debuggerPipename, this)

            this._kernelProcess = spawn(
                this.juliaExecutable.file,
                [
                    ...this.juliaExecutable.args,
                    ...args,
                    path.join(this.extensionPath, 'scripts', 'notebook', 'notebook.jl'),
                    pn,
                    this.debuggerPipename,
                    getCrashReportingPipename(),
                ],
                {
                    env,
                    cwd: cwdPath
                }
            )

            this.outputChannel.appendLine('Successfully started the kernel process from the extension.')

            const outputChannel = this.outputChannel

            this._kernelProcess.stdout.on('data', function (data) {
                outputChannel.append(String(data))
            })
            this._kernelProcess.stderr.on('data', function (data) {
                outputChannel.append(String(data))
            })
            const tokenSource = this._tokenSource
            const processExecutionRequests = this._processExecutionRequests

            this._kernelProcess.on('close', async (code) => {
                tokenSource.cancel()
                processExecutionRequests.notify()

                this._onCellRunFinished.fire()
                this._onStopped.fire(undefined)
                outputChannel.appendLine(`Kernel closed with ${code}.`)
                this._kernelProcess = undefined

                this.dispose()
            })

            this.outputChannel.appendLine(`Pre 'await connectedPromise.wait()'`)
            await connectedPromise.wait()
            this.outputChannel.appendLine(`Post 'await connectedPromise.wait()'`)

            await this.messageLoop(token)

            this._onStopped.fire(undefined)

            this.dispose()
        }
        catch (err) {
            handleNewCrashReportFromException(err, 'Extension')
            throw (err)
        }
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

    public async interrupt() {
        this._kernelProcess?.kill('SIGINT')
    }
}
