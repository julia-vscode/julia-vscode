import * as vscode from 'vscode'
import * as path from 'path'

import { registerCommand } from './utils'
import * as jlpkgenv from './jlpkgenv'
import { JuliaExecutablesFeature } from './juliaexepath'

export class JuliaCommands {
    constructor (
        private context: vscode.ExtensionContext,
        private juliaExecutableFeature: JuliaExecutablesFeature,
    ) {
        context.subscriptions.push(
            registerCommand('language-julia.runPackageCommand', async (cmd?: string, env?: string) => {
                if (cmd === undefined && env === undefined) {
                    await this.runPackageCommandInteractive()
                } else {
                    await this.runPackageCommand(cmd, env)
                }
            }),
        )
    }

    private async runPackageCommandInteractive() {
        const env = await jlpkgenv.getAbsEnvPath()

        const cmd = await vscode.window.showInputBox({
            prompt: `Enter a Pkg.jl command to be executed for ${env}`,
            placeHolder: `add Example`
        })

        if (!cmd) {
            return
        }

        const success = await this.runPackageCommand(cmd, env)

        if (success) {
            vscode.window.showInformationMessage(`Successfully ran \`${cmd}\` in environment \`${env}\`.`)
        } else {
            vscode.window.showErrorMessage(`Failed to run \`${cmd}\` in environment \`${env}\`. Check the terminals tab for the errors.`)
        }
    }

    private async runPackageCommand(cmd?: string, env?: string) {
        return await this.runCommand(
            `using Pkg; pkg"${cmd}"`,
            env,
            `Julia: ${cmd}`,
            { JULIA_PKG_PRECOMPILE_AUTO: '0' }
        )
    }

    private async runCommand(cmd: string, juliaEnv?: string, name?: string, processEnv?: {[key: string]: string;}) {
        const juliaExecutable = await this.juliaExecutableFeature.getActiveJuliaExecutableAsync()
        const args = [...juliaExecutable.args]

        if (!juliaEnv) {
            juliaEnv = await jlpkgenv.getAbsEnvPath()
        }
        if (!name) {
            name = 'Run Command'
        }

        args.push(`--project=${juliaEnv}`, '-e', cmd)

        const task = new TaskRunnerTerminal(this.context, name, juliaExecutable.file, args)
        task.show()

        await new Promise(resolve => {
            task.onDidClose(task => resolve(task))
        })

        return task.terminal.exitStatus.code === 0
    }

    public dispose() { }
}

interface TaskRunnerTerminalOptions {
    cwd?: string|vscode.Uri
    env?
    shellIntegrationNonce?: string
    message?: string,
    iconPath?: vscode.IconPath
    color?: vscode.ThemeColor
    hideFromUser?: boolean
}

export class TaskRunnerTerminal {
    public terminal: vscode.Terminal
    public onDidClose: vscode.Event<vscode.Terminal>

    pty: vscode.Pseudoterminal

    private disposables: vscode.Disposable[] = []

    constructor(context: vscode.ExtensionContext, name: string, shellPath:string, shellArgs: string[], opts: TaskRunnerTerminalOptions = {}) {
        let execPath: string
        let args: string[]

        if (process.platform === 'win32') {
            execPath = 'powershell.exe'
            args = ['-executionPolicy', 'bypass', '-File', path.join(context.extensionPath, 'scripts', 'wrappers', 'procwrap.ps1'), winEscape(shellPath), ...shellArgs.map(winEscape)]
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
            ...opts
        }

        this.terminal = vscode.window.createTerminal(options)

        const onDidCloseEmitter = new vscode.EventEmitter<vscode.Terminal>()
        this.onDidClose = onDidCloseEmitter.event

        this.disposables.push(
            onDidCloseEmitter,
            vscode.window.onDidCloseTerminal(terminal => {
                if (terminal === this.terminal) {
                    onDidCloseEmitter.fire(terminal)
                    this._dispose()
                }
            })
        )
    }

    private computeMessage(shellPath:string, shellArgs:string|string[]) {
        if (shellArgs instanceof Array) {
            shellArgs = shellArgs.join(' ')
        }
        return `\x1b[30;47m * \x1b[0m Executing task: ${shellPath} ${shellArgs}`
    }

    show() {
        this.terminal?.show()
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
