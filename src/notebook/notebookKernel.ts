import { Subject } from 'await-notify'
import * as net from 'net'
import * as path from 'path'
import { uuid } from 'uuidv4'
import * as vscode from 'vscode'
import { createMessageConnection, MessageConnection, NotificationType, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import { getAbsEnvPath } from '../jlpkgenv'
import { getJuliaExePath } from '../juliaexepath'
import { generatePipeName } from '../utils'
import { chainWithPendingUpdates } from './helpers'

interface ExecutionRequest {
    cell: vscode.NotebookCell
    executionOrder: number
}

const notifyTypeDisplay = new NotificationType<{ mimetype: string, current_request_id: number, data: string }>('display')
const notifyTypeStreamoutput = new NotificationType<{ name: string, current_request_id: number, data: string }>('streamoutput')
const notifyTypeRunCell = new NotificationType<{ current_request_id: number, code: string }>('runcell')
const notifyTypeRunCellSucceeded = new NotificationType<{ request_id: number }>('runcellsucceeded')
const notifyTypeRunCellFailed = new NotificationType<{ request_id: number, output: {ename: string, evalue: string, traceback: string}}>('runcellfailed')


export class JuliaKernel implements vscode.NotebookKernel {
    private _localDisposables: vscode.Disposable[] = []

    private executionRequests: Map<number, ExecutionRequest> = new Map<number, ExecutionRequest>();
    private _terminal: vscode.Terminal;
    private _msgConnection: MessageConnection;
    private _current_request_id: number = 0;

    public label = 'Julia Kernel'

    public supportedLanguages = ['julia']

    constructor(private document: vscode.NotebookDocument, private extensionPath: string, public isPreferred: boolean) {
    }

    public dispose() {
        console.log(this.document.fileName)
        this._localDisposables.forEach(d => d.dispose())
    }

    async executeCell(document: vscode.NotebookDocument, cell: vscode.NotebookCell): Promise<void> {
        await this.start()
        const executionOrder = ++this._current_request_id

        this.executionRequests.set(executionOrder, { cell: cell, executionOrder: executionOrder })

        chainWithPendingUpdates(cell.notebook, edit => {
            const runStartTime = Date.now()
            edit.replaceNotebookCellMetadata(cell.notebook.uri, cell.index, cell.metadata.with({
                runState: vscode.NotebookCellRunState.Running,
                runStartTime: runStartTime,
                executionOrder: executionOrder,
                statusMessage: '',
                lastRunDuration: null
            }))
            edit.replaceNotebookCellOutput(cell.notebook.uri, cell.index, [])
        })

        this._msgConnection.sendNotification(notifyTypeRunCell, { current_request_id: this._current_request_id, code: cell.document.getText() })
    }

    cancelCellExecution(document: vscode.NotebookDocument, cell: vscode.NotebookCell): void {

    }

    executeAllCells(document: vscode.NotebookDocument): void {
    }

    cancelAllCellsExecution(document: vscode.NotebookDocument): void {

    }

    public async start() {
        if (!this._terminal) {
            const connectedPromise = new Subject()
            const serverListeningPromise = new Subject()

            const pn = generatePipeName(uuid(), 'vscjl-nbk')

            const server = net.createServer(socket => {
                this._msgConnection = createMessageConnection(
                    new StreamMessageReader(socket),
                    new StreamMessageWriter(socket)
                )

                this._msgConnection.onNotification(notifyTypeRunCellSucceeded, ({ request_id }) => {
                    const runEndTime = Date.now()

                    const request = this.executionRequests.get(request_id)
                    chainWithPendingUpdates(request.cell.notebook, edit => {
                        edit.replaceNotebookCellMetadata(request.cell.notebook.uri, request.cell.index, request.cell.metadata.with({
                            runState: vscode.NotebookCellRunState.Success,
                            lastRunDuration: runEndTime - request.cell.metadata.runStartTime,
                        }))
                    })
                })

                this._msgConnection.onNotification(notifyTypeRunCellFailed, ({ request_id, output }) => {
                    const runEndTime = Date.now()

                    const request = this.executionRequests.get(request_id)

                    const cell = request.cell

                    chainWithPendingUpdates(request.cell.notebook, edit => {
                        edit.replaceNotebookCellMetadata(request.cell.notebook.uri, request.cell.index, request.cell.metadata.with({
                            runState: vscode.NotebookCellRunState.Error,
                            lastRunDuration: runEndTime - request.cell.metadata.runStartTime,
                        }))
                        edit.appendNotebookCellOutput(cell.notebook.uri, cell.index, [new vscode.NotebookCellOutput([new vscode.NotebookCellOutputItem('application/x.notebook.error-traceback', output)])])
                    })
                })

                this._msgConnection.onNotification(notifyTypeDisplay, ({ mimetype, current_request_id, data }) => {
                    // TODO This doesn't work properly, nothing ever gets shown
                    const executionRequest = this.executionRequests.get(current_request_id)

                    if (executionRequest) {
                        const cell = executionRequest.cell

                        chainWithPendingUpdates(cell.notebook, edit => {
                            edit.appendNotebookCellOutput(cell.notebook.uri, cell.index, [new vscode.NotebookCellOutput([new vscode.NotebookCellOutputItem(mimetype, data)])])
                        })
                    }
                })

                this._msgConnection.onNotification(notifyTypeStreamoutput, ({ name, current_request_id, data }) => {
                    if (name === 'stdout') {
                        const executionRequest = this.executionRequests.get(current_request_id)

                        if (executionRequest) {
                            const cell = executionRequest.cell

                            chainWithPendingUpdates(cell.notebook, edit => {
                                edit.appendNotebookCellOutput(cell.notebook.uri, cell.index, [new vscode.NotebookCellOutput([new vscode.NotebookCellOutputItem('application/x.notebook.stream', data)])])
                            })
                        }
                    }
                    else if (name === 'stderr') {
                        const executionRequest = this.executionRequests.get(current_request_id)

                        if (executionRequest) {
                            const cell = executionRequest.cell
                            chainWithPendingUpdates(cell.notebook, edit => {
                                edit.appendNotebookCellOutput(cell.notebook.uri, cell.index, [new vscode.NotebookCellOutput([new vscode.NotebookCellOutputItem('application/x.notebook.stream', data)])])
                            })
                        }
                    }
                    else {
                        throw (new Error('Unknown stream type.'))
                    }
                })

                this._msgConnection.listen()

                connectedPromise.notify()
            })

            server.listen(pn, () => {
                serverListeningPromise.notify()
            })

            await serverListeningPromise.wait()

            const jlexepath = await getJuliaExePath()
            const pkgenvpath = await getAbsEnvPath()

            this._terminal = vscode.window.createTerminal({
                name: 'Julia Notebook Kernel',
                shellPath: jlexepath,
                shellArgs: [
                    '--color=yes',
                    `--project=${pkgenvpath}`,
                    '--startup-file=no',
                    '--history-file=no',
                    path.join(this.extensionPath, 'scripts', 'notebook', 'notebook.jl'),
                    pn
                ]
            })
            this._terminal.show(false)
            const asdf: Array<vscode.Disposable> = []
            vscode.window.onDidCloseTerminal((terminal) => {
                if (terminal === this._terminal) {
                    asdf[0].dispose()
                    this._terminal = undefined
                }
            }, this, asdf)

            await connectedPromise.wait()
        }
    }

    public async restart() {
        this.stop()
        await this.start()
    }

    public stop() {

        if (this._terminal) {
            this._terminal.dispose()
            this._terminal = undefined
        }
    }
}
