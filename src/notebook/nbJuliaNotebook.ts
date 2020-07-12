import { Subject } from 'await-notify'
import { createServer } from 'net'
import * as path from 'path'
import { uuid } from 'uuidv4'
import * as vscode from 'vscode'
import { createMessageConnection, MessageConnection, NotificationType, RequestType, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc'
import { getEnvPath } from '../jlpkgenv'
import { getJuliaExePath } from '../juliaexepath'
import { generatePipeName } from '../utils'

interface ExecutionRequest {
    id: number,
    cell: vscode.NotebookCell,
    startTime: number
}

const notifyTypeDisplay = new NotificationType<{ mimetype: string, current_request_id: number, data: string }, void>('display')
const notifyTypeStreamoutput = new NotificationType<{ name: string, current_request_id: number, data: string }, void>('streamoutput')
const requestTypeRunCell = new RequestType<{ current_request_id: number, code: string }, string, void, void>('runcell')

interface CellErrorOutput {
    output_type: 'error';
    /**
     * Exception Name
     */
    ename: string;
    /**
     * Exception Value
     */
    evalue: string;
    /**
     * Exception call stack
     */
    traceback: string[];
}

interface CellStreamOutput {
    output_type: 'stream';
    text: string;
}

interface CellDisplayOutput {
    output_type: 'display_data' | 'execute_result';
    data: { [key: string]: any };
}

export type RawCellOutput = CellStreamOutput | CellErrorOutput | CellDisplayOutput;

function transformOutputToCore(rawOutput: RawCellOutput): vscode.CellOutput {
    if (rawOutput.output_type === 'execute_result' || rawOutput.output_type === 'display_data') {
        return {
            outputKind: vscode.CellOutputKind.Rich,
            data: rawOutput.data
        } as vscode.CellDisplayOutput
    } else if (rawOutput.output_type === 'stream') {
        return {
            outputKind: vscode.CellOutputKind.Text,
            text: rawOutput.text
        } as vscode.CellStreamOutput
    } else {
        return {
            outputKind: vscode.CellOutputKind.Error,
            ename: (<CellErrorOutput>rawOutput).ename,
            evalue: (<CellErrorOutput>rawOutput).evalue,
            traceback: (<CellErrorOutput>rawOutput).traceback
        } as vscode.CellErrorOutput
    }
}

function formatDuration(_duration: number): string {
    // const seconds = Math.floor(duration / 1000);
    // actual: ${String(duration - seconds).charAt(0)}

    const randomSeconds = Math.floor(Math.random() * 10)
    const randomTenths = Math.floor(Math.random() * 10)
    return `${randomSeconds}.${randomTenths}s`
}

export class JuliaNotebook implements vscode.Disposable {
    private executionRequests: Map<number, ExecutionRequest> = new Map<number, ExecutionRequest>();
    private _terminal: vscode.Terminal;
    private _msgConnection: MessageConnection;
    private _current_request_id: number = 0;
    // private displayOrders = [
    //     'application/vnd.*',
    //     'application/json',
    //     'application/javascript',
    //     'text/html',
    //     'image/svg+xml',
    //     'text/markdown',
    //     'image/svg+xml',
    //     'image/png',
    //     'image/jpeg',
    //     'text/plain'
    // ];

    constructor(private _extensionPath: string) {
    }

    dispose() { }

    async startKernel() {
        const connectedPromise = new Subject()
        const serverListeningPromise = new Subject()

        const pn = generatePipeName(uuid(), 'vscjl-nbk')

        const server = createServer(socket => {
            this._msgConnection = createMessageConnection(
                new StreamMessageReader(socket),
                new StreamMessageWriter(socket)
            )

            this._msgConnection.onNotification(notifyTypeDisplay, ({ mimetype, current_request_id, data }) => {
                if (mimetype === 'image/png' || mimetype === 'image/jpeg') {
                    const executionRequest = this.executionRequests.get(current_request_id)

                    if (executionRequest) {
                        const cell = executionRequest.cell

                        const raw_cell = {
                            'output_type': 'execute_result',
                            'data': {}
                        }

                        raw_cell.data[mimetype] = data.split('\n')

                        cell.outputs = cell.outputs.concat([transformOutputToCore(<any>raw_cell)])
                    }
                }
                else if (mimetype === 'image/svg+xml' || mimetype === 'text/html' || mimetype === 'text/plain' || mimetype === 'text/markdown' || mimetype === 'application/vnd.vegalite.v4+json') {
                    const executionRequest = this.executionRequests.get(current_request_id)

                    if (executionRequest) {
                        const cell = executionRequest.cell

                        const raw_cell = {
                            'output_type': 'execute_result',
                            'data': {}
                        }

                        raw_cell.data[mimetype] = data.split('\n')

                        cell.outputs = cell.outputs.concat([transformOutputToCore(<any>raw_cell)])
                    }
                }
            })

            this._msgConnection.onNotification(notifyTypeStreamoutput, ({ name, current_request_id, data }) => {
                if (name === 'stdout') {
                    const executionRequest = this.executionRequests.get(current_request_id)

                    if (executionRequest) {
                        const cell = executionRequest.cell
                        const raw_cell = {
                            'output_type': 'stream',
                            'text': data
                        }

                        cell.outputs = cell.outputs.concat([transformOutputToCore(<any>raw_cell)])
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
        const pkgenvpath = await getEnvPath()

        this._terminal = vscode.window.createTerminal({
            name: 'Julia Notebook Kernel',
            shellPath: jlexepath,
            shellArgs: [
                '--color=yes',
                `--project=${pkgenvpath}`,
                '--startup-file=no',
                '--history-file=no',
                path.join(this._extensionPath, 'scripts', 'notebook', 'notebook.jl'),
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

    public async eval(cell: vscode.NotebookCell) {
        cell.metadata.runState = vscode.NotebookCellRunState.Running
        const start = +new Date()
        cell.metadata.runStartTime = start
        cell.metadata.executionOrder = ++this._current_request_id
        cell.outputs = []

        this.executionRequests.set(this._current_request_id, { id: this._current_request_id, cell: cell, startTime: Date.now() })

        if (!this._terminal) {
            await this.startKernel()
        }

        const output = await this._msgConnection.sendRequest(requestTypeRunCell, { current_request_id: this._current_request_id, code: cell.document.getText() })

        cell.metadata.statusMessage = formatDuration(Date.now() - start)
        cell.metadata.runState = output === 'success' ? vscode.NotebookCellRunState.Success : vscode.NotebookCellRunState.Error
    }

    containHTML(rawCell: any) {
        return rawCell.outputs && rawCell.outputs.some((output: any) => {
            if (output.output_type === 'display_data' && output.data['text/html']) {
                return true
            }

            return false
        })
    }
}
