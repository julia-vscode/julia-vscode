import { Subject } from 'await-notify'
import * as net from 'net'
import * as path from 'path'
import { uuid } from 'uuidv4'
import * as vscode from 'vscode'
import { createMessageConnection, MessageConnection, NotificationType, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import { getAbsEnvPath } from '../jlpkgenv'
import { getJuliaExePath } from '../juliaexepath'
import { getCrashReportingPipename } from '../telemetry'
import { generatePipeName } from '../utils'

interface ExecutionRequest {
	task: vscode.NotebookCellExecutionTask
	startTime: number;
}

const notifyTypeDisplay = new NotificationType<{ mimetype: string, current_request_id: number, data: string }>('display')
const notifyTypeStreamoutput = new NotificationType<{ name: string, current_request_id: number, data: string }>('streamoutput')
const notifyTypeRunCell = new NotificationType<{ current_request_id: number, code: string }>('notebook/runcell')
const notifyTypeRunCellSucceeded = new NotificationType<{ request_id: number }>('runcellsucceeded')
const notifyTypeRunCellFailed = new NotificationType<{ request_id: number, output: {ename: string, evalue: string, traceback: string}}>('runcellfailed')

export class JuliaKernel implements vscode.NotebookKernel {
    private _localDisposables: vscode.Disposable[] = []

    private executionRequests: Map<number, ExecutionRequest> = new Map<number, ExecutionRequest>();
    private _terminal: vscode.Terminal;
    private _msgConnection: MessageConnection;
    private _current_request_id: number = 0;

    public id = 'JuliaKernel'
    public label = 'Julia Kernel'

    public supportedLanguages = ['julia']

    constructor(private document: vscode.NotebookDocument, private extensionPath: string, public isPreferred: boolean) {
    }
	description?: string
	detail?: string
	preloads?: vscode.Uri[]
	async executeCellsRequest(document: vscode.NotebookDocument, ranges: vscode.NotebookCellRange[]): Promise<void> {
	    const cells = document.cells.filter(
	        (cell) =>
	            cell.kind === vscode.NotebookCellKind.Code &&
                ranges.some((range) => range.start <= cell.index && cell.index < range.end)
	    )
	    await Promise.all(cells.map(this.executeCell.bind(this)))
	}

	public dispose() {
	    console.log(this.document.fileName)
	    this._localDisposables.forEach(d => d.dispose())
	}

	async executeCell(cell: vscode.NotebookCell): Promise<void> {
	    const task = vscode.notebook.createNotebookCellExecutionTask(cell.notebook.uri, cell.index, this.id)
	    task.clearOutput()
	    await this.start()
	    const startTime = Date.now()
	    task.start({startTime})
	    const executionOrder = ++this._current_request_id
	    task.executionOrder = executionOrder
	    this.executionRequests.set(executionOrder, { startTime, task })
	    this._msgConnection.sendNotification(notifyTypeRunCell, { current_request_id: this._current_request_id, code: cell.document.getText() })
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
	                const { task, startTime } = this.executionRequests.get(request_id)
	                task.end({ success: true, duration: runEndTime - startTime })
	            })

	            this._msgConnection.onNotification(notifyTypeRunCellFailed, ({ request_id, output }) => {
	                const runEndTime = Date.now()
	                const { task, startTime } = this.executionRequests.get(request_id)
	                task.appendOutput([new vscode.NotebookCellOutput([new vscode.NotebookCellOutputItem('application/x.notebook.error-traceback', output)])])
	                task.end({ success: false, duration: runEndTime - startTime })
	            })

	            this._msgConnection.onNotification(notifyTypeDisplay, ({ mimetype, current_request_id, data }) => {
	                const executionRequest = this.executionRequests.get(current_request_id)

	                if (executionRequest) {
	                    executionRequest.task.appendOutput([new vscode.NotebookCellOutput([new vscode.NotebookCellOutputItem(mimetype, data)])])
	                }
	            })

	            this._msgConnection.onNotification(notifyTypeStreamoutput, ({ name, current_request_id, data }) => {
	                if (name === 'stdout') {
	                    const executionRequest = this.executionRequests.get(current_request_id)
	                    if (executionRequest) {
	                        executionRequest.task.appendOutput([new vscode.NotebookCellOutput([new vscode.NotebookCellOutputItem('application/x.notebook.stdout', data)])])
	                    }
	                }
	                else if (name === 'stderr') {
	                    const executionRequest = this.executionRequests.get(current_request_id)
	                    if (executionRequest) {
	                        executionRequest.task.appendOutput([new vscode.NotebookCellOutput([new vscode.NotebookCellOutputItem('application/x.notebook.stderr', data)])])
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
	                pn,
	                getCrashReportingPipename()
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
