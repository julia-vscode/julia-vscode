import * as vscode from 'vscode'
import * as path from 'path'

export interface TaskRunnerTerminalOptions {
    cwd?: string | vscode.Uri
    env?: { [key: string]: string }
    shellIntegrationNonce?: string
    message?: string
    iconPath?: vscode.IconPath
    color?: vscode.ThemeColor
    hideFromUser?: boolean
}

// This is basically a very basic reimplmentation of the vscode.Task API, kinda.
//
// The task API isn't tractable here because it does not work if there is no open
// workspace and doesn't give us any control over the terminal.
//
// This implementation is not great either, since
// 1. it requires wrapping the actual program in a script (which may work very badly on Windows)
// 2. doesn't address the issue of separating the process lifecycle from the terminal lifecycle
//
// A "correct" (better) implementation would instead use the ExtensionTerminalOptions constructor
// with a custom PTY that and maybe a task manager class. See
// https://github.com/swiftlang/vscode-swift/blob/a19d0b1bfe2d7a1740f8cf94c6503f584e34c71b/src/tasks/SwiftPseudoterminal.ts
// for inspiration.
export class TaskRunnerTerminal {
    public terminal: vscode.Terminal
    public onDidClose: vscode.Event<vscode.Terminal>

    private disposables: vscode.Disposable[] = []

    constructor(
        context: vscode.ExtensionContext,
        name: string,
        shellPath: string,
        shellArgs: string[],
        opts: TaskRunnerTerminalOptions = {}
    ) {
        let execPath: string
        let args: string[]

        if (process.platform === 'win32') {
            execPath = 'powershell.exe'
            args = [
                '-executionPolicy',
                'bypass',
                '-File',
                path.join(context.extensionPath, 'scripts', 'wrappers', 'procwrap.ps1'),
                winEscape(shellPath),
                ...shellArgs.map(winEscape),
            ]
        } else {
            execPath = path.join(context.extensionPath, 'scripts', 'wrappers', 'procwrap.sh')
            args = [shellPath, ...shellArgs]
        }

        const options: vscode.TerminalOptions = {
            hideFromUser: true,
            name: name,
            message: this.computeMessage(shellPath, shellArgs),
            isTransient: true,
            shellPath: execPath,
            shellArgs: args,
            iconPath: new vscode.ThemeIcon('tools'),
            ...opts,
        }

        this.terminal = vscode.window.createTerminal(options)

        const onDidCloseEmitter = new vscode.EventEmitter<vscode.Terminal>()
        this.onDidClose = onDidCloseEmitter.event

        this.disposables.push(
            onDidCloseEmitter,
            vscode.window.onDidCloseTerminal((terminal) => {
                if (terminal === this.terminal) {
                    onDidCloseEmitter.fire(terminal)
                    this._dispose()
                }
            })
        )
    }

    private computeMessage(shellPath: string, shellArgs: string[]) {
        return `\x1b[30;47m * \x1b[0m Executing task: ${shellPath} ${shellArgs}`
    }

    show(preserveFocus?: boolean) {
        this.terminal?.show(preserveFocus)
    }

    hide() {
        this.terminal?.hide()
    }

    private _dispose() {
        this.disposables?.forEach((d) => d?.dispose())
    }

    dispose() {
        this.terminal?.dispose()
        this._dispose()
    }
}

function winEscape(str: string) {
    return str.replace(/"/g, '\\"')
}
