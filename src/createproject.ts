import * as fs from 'async-file'
import * as path from 'path'
import * as vscode from 'vscode'
import { JuliaExecutablesFeature } from './juliaexepath'
import { registerCommand } from './utils'

export class JuliaNewProjectFeature {
    constructor(private context: vscode.ExtensionContext, private juliaExecutablesFeature: JuliaExecutablesFeature) {
        this.context.subscriptions.push(registerCommand('language-julia.createNewProject', () => this.createNewProject()))
    }

    private async createNewProject() {

        const pkgName = await vscode.window.showInputBox({
            prompt: 'Please enter the name of the project to create.',
            validateInput: (input) => {
                if (input === "")
                    return 'The project name cannot be empty.'
                return undefined
            }
        })
        if (!pkgName)
            return

        const authors = await vscode.window.showInputBox({ prompt: 'Please enter the authors of the project', placeHolder: "Default uses 'github.name' and 'github.email' from the global Git config." })
        if (authors === undefined)
            return

        let host = await vscode.window.showQuickPick(['github.com', 'gitlab.com', 'bitbucket.org', 'Other'], { placeHolder: 'The URL to the code hosting service where the project will reside.' })
        if (host === 'Other') {
            host = await vscode.window.showInputBox({ prompt: 'Please enter the URL to the code hosting service.' })
        }
        if (host === undefined)
            return

        // TODO: add gihub.user as placeholder
        const user = await vscode.window.showInputBox({
            prompt: 'Please enter your GitHub (or other code hosting service) username.',
            validateInput: (input) => {
                if (input === "")
                    return 'Username cannot be empty.'
                return undefined
            }
        })
        if (user === undefined)
            return

        let juliaVersion = await vscode.window.showQuickPick(
            ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', 'Other'],
            { placeHolder: 'Please select the minimum allowed Julia version.' }
        )
        if (juliaVersion === 'Other') {
            juliaVersion = await vscode.window.showInputBox({ prompt: 'Please enter the minimum allowed Julia version.' })
        }
        if (juliaVersion === undefined)
            return

        const plugins = await vscode.window.showQuickPick(
            [
                { label: 'Project File', picked: true },
                { label: 'Source Directory', picked: true },
                { label: 'Git', picked: true },
                { label: 'License', picked: true },
                { label: 'README', picked: true },
                { label: 'Tests', picked: true },
                { label: 'CompatHelper', picked: true },
                { label: 'TagBot', picked: true },
                { label: 'AppVeyor', picked: false },
                { label: 'BlueStyleBadge', picked: false },
                { label: 'CirrusCI', picked: false },
                { label: 'Citation', picked: false },
                { label: 'Codecov', picked: false },
                { label: 'ColPracBadge', picked: false },
                { label: 'Coveralls', picked: false },
                // { label: 'Develop', picked: false },
                { label: 'Documenter', picked: false },
                { label: 'DroneCI', picked: false },
                { label: 'GitHubActions', picked: false },
                { label: 'GitLabCI', picked: false },
                { label: 'PkgEvalBadge', picked: false },
                { label: 'RegisterAction', picked: false },
                { label: 'TravisCI', picked: false }
            ],
            { canPickMany: true, placeHolder: 'Please select plugins to include in the template.' }
        )
        if (plugins === undefined)
            return

        const directory = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select Project Location'
        })
        if (!directory)
            return

        const juliaExecutable = await this.juliaExecutablesFeature.getActiveJuliaExecutableAsync()

        const newTerm = vscode.window.createTerminal(
            {
                name: 'Julia: Create new project',
                shellPath: juliaExecutable.file,
                shellArgs: [
                    ...juliaExecutable.args,
                    path.join(this.context.extensionPath, 'scripts', 'packagedev', 'createproject.jl'),
                    pkgName,
                    directory[0].fsPath,
                    authors,
                    host,
                    user,
                    juliaVersion,
                    ...plugins.map(x => x.label)
                ],
                env: {
                    JULIA_PROJECT: path.join(this.context.extensionPath, 'scripts', 'environments', 'newproject')
                }

            }
        )
        newTerm.show(true)

        const disposable = vscode.window.onDidCloseTerminal(async t => {
            if (t.processId === newTerm.processId) {
                const projectPath = vscode.Uri.file(path.join(directory[0].fsPath, pkgName))
                if (t.exitStatus && t.exitStatus.code === 0 && await fs.exists(projectPath.fsPath)) {
                    let message = "Would you like to open the new project?"
                    const open = "Open"
                    const openNewWindow = "Open in New Window"
                    const choices = [open, openNewWindow]

                    const addToWorkspace = "Add to Workspace"
                    if (vscode.workspace.workspaceFolders) {
                        message = "Would you like to open the cloned repository, or add it to the current workspace?"
                        choices.push(addToWorkspace)
                    }

                    const result = await vscode.window.showInformationMessage(message, ...choices)

                    if (result === open) {
                        vscode.commands.executeCommand('vscode.openFolder', projectPath, { forceReuseWindow: true })
                    } else if (result === addToWorkspace) {
                        vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders!.length, 0, { uri: projectPath })
                    } else if (result === openNewWindow) {
                        vscode.commands.executeCommand('vscode.openFolder', projectPath, { forceNewWindow: true })
                    }
                } else {
                    vscode.window.showErrorMessage("Could not create the project.")
                }
                disposable.dispose()
            }
        })

    }

    public dispose() { }
}
