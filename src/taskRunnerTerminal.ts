import * as vscode from 'vscode'
import { JuliaPTY, JuliaPTYOptions } from './utils/pty'
import { JuliaProcess } from './utils/process'

export interface TaskRunnerTerminalOptions extends JuliaPTYOptions {
    cwd?: string | vscode.Uri
    env?: { [key: string]: string }
    iconPath?: vscode.IconPath
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
            ...opts,
        }

        this.disposables.push(
            vscode.window.onDidCloseTerminal((terminal) => {
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
        this.proc = new JuliaProcess(shellPath, shellArgs, { cwd, env: opts.env })
        this.proc.onDidClose((ev) => {
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

    constructor(
        private name: string,
        private iconPath: vscode.IconPath
    ) {}

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

    private runQueueItem() {
        if (this.isRunning) {
            return
        }
        const item = this.queue.shift()
        if (!item) {
            return
        }

        this.isRunning = true
        if (this.terminal) {
            this.terminal.attach(item.shellPath, item.shellArgs, item.opts)
        } else {
            this.terminal = new TaskRunnerTerminal(this.name, item.shellPath, item.shellArgs, {
                iconPath: this.iconPath,
                ...item.opts,
            })
            this.terminal.onDidClose(() => {
                this.terminal = undefined
            })
        }

        if (item.show) {
            this.terminal.show()
        }

        this.terminal.onDidExitProcess((ev) => {
            this.isRunning = false
            item.emitter.fire(ev)
            item.emitter.dispose()

            this.runQueueItem()
        })
    }
}
