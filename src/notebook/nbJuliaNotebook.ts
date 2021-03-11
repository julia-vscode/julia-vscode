import * as vscode from 'vscode'
import { JuliaKernel } from './notebookKernel'



export class JuliaNotebook implements vscode.Disposable {

    private juliaKernel: JuliaKernel;

    private debugging = false
    private activeDebugSession: vscode.DebugSession | undefined
    private disposables: vscode.Disposable[] = [];
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

    constructor(doc: vscode.NotebookDocument, extensionPath: string) {
        this.juliaKernel = new JuliaKernel(doc, extensionPath)
    }

    async dispose() {
        await this.stopDebugger()
        this.juliaKernel.stop()
    }

    async attachDebugger(pn: string) {
        await this.juliaKernel.attachDebugger(pn)
    }

    public async toggleDebugging(document: vscode.NotebookDocument) {

        if (this.debugging) {
            // TODO SOMETHING HERE
        }

        this.debugging = !this.debugging

        for (const cell of document.cells) {
            if (cell.kind === vscode.NotebookCellKind.Code) {
                cell.metadata.breakpointMargin = this.debugging
            }
        }
    }

    public addDebugSession(session: vscode.DebugSession) {
        if (this.activeDebugSession) {
            console.log(`error: there is already a debug session`)
            return
        }
        this.activeDebugSession = session
    }

    public removeDebugSession(session: vscode.DebugSession) {
        if (this.activeDebugSession !== session) {
            console.log(`error: removed session doesn't match active session`)
            return
        }
        this.activeDebugSession = undefined
    }

    private async startDebugger() {
        if (!this.activeDebugSession) {
            try {
                await vscode.debug.startDebugging(undefined, this.juliaKernel.getLaunchConfig())
            } catch (err) {
                console.log(`error: ${err}`)
            }
        }
    }

    private async stopDebugger() {
        if (this.activeDebugSession) {
            await vscode.commands.executeCommand('workbench.action.debug.stop')
            this.disposables.forEach(d => d.dispose())
            this.disposables = []
        }
    }

    async startKernel() {

    }

    public async eval(cell: vscode.NotebookCell) {
        await this.juliaKernel.start()
        if (this.debugging) {
            await this.startDebugger()
        }
        return this.juliaKernel.eval(cell)
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
