import * as vscode from 'vscode'
import { JuliaPTY, JuliaPTYOptions } from './utils/pty'
import { JuliaProcess } from './utils/process'

export interface TaskRunnerTerminalOptions extends JuliaPTYOptions {
    cwd?: string | vscode.Uri
    env?: { [key: string]: string }
    iconPath?: vscode.IconPath
    hideFromUser?: boolean // currently not functional
}

export class TaskRunnerTerminal {
    public terminal: vscode.Terminal
    private onDidCloseEmitter = new vscode.EventEmitter<number | void>()
    public onDidClose: vscode.Event<number | void> = this.onDidCloseEmitter.event

    private disposables: vscode.Disposable[] = []

    constructor(name: string, shellPath: string, shellArgs: string[], opts: TaskRunnerTerminalOptions = {}) {
        const proc = new JuliaProcess(shellPath, shellArgs, { env: opts.env })
        const pty = new JuliaPTY(proc, opts)

        proc.onDidClose((ev) => {
            this.onDidCloseEmitter.fire(ev)
        })

        const options: vscode.ExtensionTerminalOptions = {
            name: name,
            isTransient: true,
            pty: pty,
            iconPath: new vscode.ThemeIcon('tools'),
            ...opts,
        }

        this.terminal = vscode.window.createTerminal(options)
    }

    show(preserveFocus?: boolean) {
        this.terminal?.show(preserveFocus)
    }

    hide() {
        this.terminal?.hide()
    }

    private _dispose() {
        for (const disposable of this.disposables) {
            disposable.dispose()
        }
    }

    dispose() {
        this.terminal?.dispose()
        this._dispose()
    }
}
