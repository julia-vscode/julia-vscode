import * as vscode from 'vscode'

import { registerCommand } from './utils'
import * as jlpkgenv from './jlpkgenv'
import { JuliaExecutablesFeature } from './juliaexepath'
import { TaskRunnerTerminal } from './taskRunnerTerminal'

export class JuliaCommands {
    constructor(
        context: vscode.ExtensionContext,
        private juliaExecutableFeature: JuliaExecutablesFeature
    ) {
        context.subscriptions.push(
            registerCommand('language-julia.runPackageCommand', async (cmd?: string, env?: string) => {
                if (cmd === undefined && env === undefined) {
                    await this.runPackageCommandInteractive()
                } else {
                    await this.runPackageCommand(cmd, env)
                }
            }),
            registerCommand('language-julia.instantiateEnvironment', async (env?: string) => {
                await this.runPackageCommand('instantiate', env)
            })
        )
    }

    private async runPackageCommandInteractive() {
        const env = await jlpkgenv.getAbsEnvPath()

        const cmd = await vscode.window.showInputBox({
            prompt: `Enter a Pkg.jl command to be executed for ${env}`,
            placeHolder: `add Example`,
        })

        if (!cmd) {
            return
        }

        const success = await this.runPackageCommand(cmd, env)

        if (success) {
            vscode.window.showInformationMessage(`Successfully ran \`${cmd}\` in environment \`${env}\`.`)
        } else {
            vscode.window.showErrorMessage(
                `Failed to run \`${cmd}\` in environment \`${env}\`. Check the terminals tab for the errors.`
            )
        }
    }

    private async runPackageCommand(cmd?: string, env?: string) {
        return await this.runCommand(`using Pkg; pkg"${cmd}"`, env, `Julia: ${cmd}`, { JULIA_PKG_PRECOMPILE_AUTO: '0' })
    }

    private async runCommand(cmd: string, juliaEnv?: string, name?: string, processEnv?: { [key: string]: string }) {
        const juliaExecutable = await this.juliaExecutableFeature.getActiveJuliaExecutableAsync()
        const args = [...juliaExecutable.args]

        if (!juliaEnv) {
            juliaEnv = await jlpkgenv.getAbsEnvPath()
        }
        if (!name) {
            name = 'Run Command'
        }

        args.push(`--project=${juliaEnv}`, '-e', cmd)

        const task = new TaskRunnerTerminal(name, juliaExecutable.file, args, {
            env: {
                ...process.env,
                ...processEnv,
            },
        })
        task.show()

        await new Promise((resolve) => {
            task.onDidClose((task) => resolve(task))
        })

        return task.terminal.exitStatus.code === 0
    }

    public dispose() {}
}
