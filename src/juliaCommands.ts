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
                `Failed to run \`${cmd}\` in environment \`${env}\`. Check the terminals tab for the process output.`
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
            onExitMessage(exitCode) {
                if (exitCode === 0) {
                    return '\n\r\x1b[30;47m * \x1b[0m Successfully ran this command. Press any key to close the terminal.\n\r'
                }
                return `\n\r\x1b[30;47m * \x1b[0m Failed to run this command (exit code ${exitCode}). Press any key to close the terminal.\n\r`
            },
        })
        task.show()

        const exitCode = await new Promise((resolve) => {
            task.onDidClose((ev) => resolve(ev))
        })

        return exitCode === 0
    }

    public dispose() {}
}
