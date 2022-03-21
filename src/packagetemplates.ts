import * as path from 'path'
import * as vscode from 'vscode'
import { JuliaExecutablesFeature } from './juliaexepath'
import { registerCommand } from './utils'

export class JuliaPackageTemplateFeature {
    constructor(private context: vscode.ExtensionContext, private juliaExecutablesFeature: JuliaExecutablesFeature) {
        this.context.subscriptions.push(registerCommand('language-julia.createPackageTemplate', () => this.createPackageTemplate()))
    }

    private async createPackageTemplate() {

        const pkgName = await vscode.window.showInputBox({ prompt: 'Please enter the name of the package to create.' })

        if (pkgName) {
            const juliaExecutable = await this.juliaExecutablesFeature.getActiveJuliaExecutableAsync()

            const newTerm = vscode.window.createTerminal(
                {
                    name: 'Julia: Create package template',
                    shellPath: juliaExecutable.file,
                    shellArgs: [
                        ...juliaExecutable.args,
                        path.join(this.context.extensionPath, 'scripts', 'packagedev', 'createpackagetemplate.jl'),
                        pkgName
                    ],
                    env: {
                        JULIA_PROJECT: path.join(this.context.extensionPath, 'scripts', 'environments', 'pkgdev')
                    },

                }
            )

            newTerm.show(true)
        }
    }

    public dispose() { }
}
