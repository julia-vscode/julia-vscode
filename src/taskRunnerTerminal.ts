import * as vscode from 'vscode'
import { JuliaPTY, JuliaPTYOptions } from './utils/pty'
import { JuliaProcess } from './utils/process'
import { onEvent } from './utils'
import { randomUUID } from 'crypto'

export interface TaskRunnerTerminalOptions extends JuliaPTYOptions {
    cwd?: string | vscode.Uri
    env?: { [key: string]: string }
    iconPath?: vscode.IconPath
    shellIntegrationNonce?: string
    hideFromUser?: boolean // currently not functional
}

export interface TaskOptions extends JuliaPTYOptions {
    cwd?: string | vscode.Uri
    env?: { [key: string]: string }
    show?: boolean
}

interface TaskQueueItem {
    shellPath: string
    shellArgs: string[]
    opts: TaskOptions
    emitter: vscode.EventEmitter<number | void>
    show: boolean
}

export class TaskRunnerTerminal {
    public terminal: vscode.Terminal
    private onDidExitProcessEmitter = new vscode.EventEmitter<number | void>()
    public onDidExitProcess: vscode.Event<number | void> = this.onDidExitProcessEmitter.event
    private onDidCloseEmitter = new vscode.EventEmitter<void>()
    public onDidClose: vscode.Event<void> = this.onDidCloseEmitter.event

    private pty: JuliaPTY
    private proc: JuliaProcess
    private disposables: vscode.Disposable[] = []

    constructor(name: string, shellPath: string, shellArgs: string[], opts: TaskRunnerTerminalOptions = {}) {
        this.attach(shellPath, shellArgs, opts)

        const options: vscode.ExtensionTerminalOptions = {
            name: name,
            isTransient: true,
            pty: this.pty,
            iconPath: new vscode.ThemeIcon('tools'),
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri,
            ...opts,
        }

        this.disposables.push(
            onEvent(vscode.window.onDidCloseTerminal, (terminal) => {
                if (terminal === this.terminal) {
                    this.onDidCloseEmitter.fire()
                    this.dispose()
                }
            })
        )

        this.terminal = vscode.window.createTerminal(options)
    }

    attach(shellPath: string, shellArgs: string[], opts: TaskRunnerTerminalOptions = {}) {
        this.proc?.dispose()

        const cwd = opts.cwd instanceof vscode.Uri ? opts.cwd.fsPath : opts.cwd
        this.proc = new JuliaProcess(shellPath, shellArgs, {
            cwd,
            env: {
                VSCODE_NONCE: opts.shellIntegrationNonce,
                ...opts.env,
            },
        })
        onEvent(this.proc.onDidClose, (ev) => {
            this.onDidExitProcessEmitter.fire(ev)
        })
        if (this.pty) {
            this.pty.respawn(this.proc, opts)
        } else {
            this.pty = new JuliaPTY(this.proc, opts)
        }
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
        this.proc?.terminate()
        this.proc?.dispose()

        this.terminal?.dispose()

        this._dispose()
    }
}

export class TaskRunner {
    private terminal: TaskRunnerTerminal
    private queue: TaskQueueItem[] = []
    private isRunning: boolean = false
    private statusBarItem: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)
    private disposables: vscode.Disposable[] = []

    private showCommand: string = `language-julia.${randomUUID()}`

    constructor(
        private name: string,
        private iconPath: vscode.IconPath
    ) {
        this.statusBarItem.name = name
        this.disposables.push(vscode.commands.registerCommand(this.showCommand, () => this.terminal.show()))
    }

    public run(shellPath: string, shellArgs: string[], opts: TaskOptions = {}): Promise<number | void> {
        const emitter = new vscode.EventEmitter<number | void>()
        const p = new Promise<number | void>((resolve) => {
            emitter.event((ev) => {
                resolve(ev)
            })
        })

        this.queue.push({
            shellPath,
            shellArgs,
            opts,
            emitter,
            show: opts.show !== false,
        })

        this.runQueueItem()

        return p
    }

    public show() {
        this.terminal?.show()
    }

    private runQueueItem() {
        if (this.isRunning) {
            return
        }
        const item = this.queue.shift()
        if (!item) {
            return
        }

        this.isRunning = true

        this.statusBarItem.text = `$(loading~spin) ${this.name}`
        this.statusBarItem.tooltip = new vscode.MarkdownString(
            `${this.name} is now running\n\`\`\`\n${item.shellPath} ${item.shellArgs.map((s) => `"${s}"`).join(' ')}\n\`\`\`\n`
        )
        this.statusBarItem.command = {
            command: this.showCommand,
            title: 'Show terminal',
        }
        this.statusBarItem.show()
        if (this.terminal) {
            this.terminal.attach(item.shellPath, item.shellArgs, item.opts)
        } else {
            this.terminal = new TaskRunnerTerminal(this.name, item.shellPath, item.shellArgs, {
                iconPath: this.iconPath,
                ...item.opts,
            })
            onEvent(this.terminal.onDidClose, () => {
                this.terminal = undefined
            })
            this.disposables.push(this.terminal)
        }

        if (item.show) {
            this.terminal.show()
        }

        onEvent(this.terminal.onDidExitProcess, (ev) => {
            this.statusBarItem.hide()
            this.isRunning = false
            item.emitter.fire(ev)
            item.emitter.dispose()

            this.runQueueItem()
        })
    }

    public dispose() {
        this.queue = []
        this.disposables.forEach((e) => e.dispose())
    }
}
