import * as fs from 'async-file'
import * as path from 'path'
import * as vscode from 'vscode'
import * as packagepath from './packagepath'
import * as telemetry from './telemetry'
import { registerCommand } from './utils'

// This method implements the language-julia.openPackageDirectory command
async function openPackageDirectoryCommand() {
    telemetry.traceEvent('command-openpackagedirectory')

    const optionsPackage: vscode.QuickPickOptions = {
        placeHolder: 'Select package'
    }

    try {
        const juliaVersionHomeDir = await packagepath.getPkgPath()

        const files = await fs.readdir(juliaVersionHomeDir)

        const filteredPackages = files.filter(path => !path.startsWith('.') && ['METADATA', 'REQUIRE', 'META_BRANCH'].indexOf(path) < 0)

        if (filteredPackages.length === 0) {
            vscode.window.showInformationMessage('Error: There are no packages installed.')
        }
        else {
            const resultPackage = await vscode.window.showQuickPick(filteredPackages, optionsPackage)

            if (resultPackage !== undefined) {
                const folder = vscode.Uri.file(path.join(juliaVersionHomeDir, resultPackage))

                try {
                    await vscode.commands.executeCommand('vscode.openFolder', folder, true)
                }
                catch {
                    vscode.window.showInformationMessage('Could not open the package.')
                }
            }
        }
    }
    catch {
        vscode.window.showInformationMessage('Error: Could not read package directory.')
    }
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(registerCommand('language-julia.openPackageDirectory', openPackageDirectoryCommand))
}
