import * as vscode from 'vscode'
import * as process from 'process'

import { registerCommand } from './utils'
import * as jlpkgenv from './jlpkgenv'
import { JuliaExecutablesFeature } from './juliaexepath'

export class JuliaCommands {
    constructor (
        context: vscode.ExtensionContext,
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

        const task = new vscode.Task(
            {
                type: 'julia',
                command: 'runCommand'
            },
            name,
            'Julia',
            new vscode.ProcessExecution(
                juliaExecutable.file,
                args, {
                    env: {...process.env, ...processEnv}
                }
            ),
            ''
        )

        task.presentationOptions = {
            focus: false,
            reveal: vscode.TaskRevealKind.Always,
        }

        let disposable: vscode.Disposable

        try {
            const taskExecution = await vscode.tasks.executeTask(task)

            const event: vscode.TaskProcessEndEvent = await new Promise(resolve => {
                disposable = vscode.tasks.onDidEndTaskProcess(ev => {
                    if (ev.execution === taskExecution) {
                        resolve(ev)
                    }
                })
            })

            return event.exitCode === 0
        } catch (err) {
            console.error(err)
        }

        disposable?.dispose()

        return false
    }

    public dispose() { }
}
