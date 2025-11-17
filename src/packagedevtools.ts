import * as path from 'path'
import * as vscode from 'vscode'
import { JuliaExecutablesFeature } from './juliaexepath'
import * as telemetry from './telemetry'
import { registerCommand } from './utils'

export class JuliaPackageDevFeature {
    constructor(
        private context: vscode.ExtensionContext,
        private juliaExecutablesFeature: JuliaExecutablesFeature
    ) {
        this.context.subscriptions.push(
            registerCommand('language-julia.tagNewPackageVersion', () => this.tagNewPackageVersion())
        )
    }

    private async tagNewPackageVersion() {
        telemetry.traceEvent('command-tagnewpackageversion')

        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            let resultVersion = await vscode.window.showQuickPick(['Next', 'Major', 'Minor', 'Patch', 'Custom'], {
                placeHolder: 'Please select the version to be tagged.',
            })

            if (resultVersion === 'Custom') {
                resultVersion = await vscode.window.showInputBox({
                    prompt: 'Please enter the version number you want to tag.',
                })
            }

            if (resultVersion !== undefined) {
                const bar = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true })
                const accessToken = bar.accessToken
                const account = bar.account.label

                const juliaExecutable = await this.juliaExecutablesFeature.getActiveJuliaExecutableAsync()

                if (juliaExecutable.getVersion().compare('1.6.0') >= 0) {
                    const newTerm = vscode.window.createTerminal({
                        name: 'Julia: Tag a new package version',
                        shellPath: juliaExecutable.file,
                        shellArgs: [
                            ...juliaExecutable.args,
                            path.join(this.context.extensionPath, 'scripts', 'packagedev', 'tagnewpackageversion.jl'),
                            accessToken,
                            account,
                            resultVersion,
                        ],
                        cwd: vscode.workspace.workspaceFolders[0].uri.fsPath,
                    })

                    newTerm.show(true)
                } else {
                    await vscode.window.showErrorMessage(
                        'Tagging package versions is only supported on Julia 1.6 and newer.'
                    )
                }
            }
        }
    }

    public dispose() {}
}
