import * as fs from 'async-file'
import * as path from 'path'
import * as vscode from 'vscode'
import { JuliaExecutablesFeature } from './juliaexepath'
import { registerCommand } from './utils'
import simpleGit from 'simple-git'

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

        const templateType = await vscode.window.showQuickPick(['Default', 'Custom'], { placeHolder: "Select a template for the project" })
        if (!templateType)
            return

        const userResult = await simpleGit().getConfig('github.user', 'global')
        const defaultUser = userResult.value
        const user = await vscode.window.showInputBox({
            prompt: 'Please enter your GitHub (or other code hosting service) username.',
            value: defaultUser,
            validateInput: (input) => {
                if (input === "")
                    return 'Username cannot be empty.'
                return undefined
            }
        })
        if (user === undefined)
            return

        let authors = ''
        let host = ''
        let juliaVersion = ''
        let plugins: vscode.QuickPickItem[] = []
        if (templateType == 'Custom') {
            const authors = await vscode.window.showInputBox({ prompt: 'Please enter the authors of the project', placeHolder: "Leave blank to use 'user.name' and 'user.email' from the global Git config." })
            if (authors === undefined)
                return

            let host = await vscode.window.showQuickPick(['github.com', 'gitlab.com', 'bitbucket.org', 'Other'], { placeHolder: 'The URL to the code hosting service where the project will reside.' })
            if (host === 'Other') {
                host = await vscode.window.showInputBox({ prompt: 'Please enter the URL to the code hosting service.' })
            }
            if (host === undefined)
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

            plugins = await vscode.window.showQuickPick(
                [
                    { label: 'Project File', picked: true, description: 'Creates a Project.toml' },
                    { label: 'Source Directory', picked: true, description: 'Creates a src directory' },
                    { label: 'Git', picked: true, description: 'Creates a Git repository' },
                    { label: 'License', picked: true, description: 'Creates a license file' },
                    { label: 'README', picked: true, description: 'Creates a README file' },
                    { label: 'Tests', picked: true, description: 'Creates a test directory' },
                    { label: 'CompatHelper', picked: true, description: 'Dependency management' },
                    { label: 'TagBot', picked: true, description: 'GitHub release support' },
                    { label: 'AppVeyor', picked: false, description: 'CI via AppVeyor' },
                    { label: 'BlueStyleBadge', picked: false, description: 'Adds a BlueStyleBadge to the README' },
                    { label: 'CirrusCI', picked: false, description: 'CI via CirrusCI' },
                    { label: 'Citation', picked: false, description: 'Creates a CITATION.bib file' },
                    { label: 'Codecov', picked: false, description: 'Code coverage via Codecov' },
                    { label: 'ColPracBadge', picked: false, description: 'Adds a ColPracBadge to the README' },
                    { label: 'Coveralls', picked: false, description: 'Code coverage via Coveralls' },
                    // { label: 'Develop', picked: false }, // Disabled since the script will not run in the user's environment
                    { label: 'Documenter', picked: false, description: 'Documentation generation' },
                    { label: 'DroneCI', picked: false, description: 'CI via DroneCI' },
                    { label: 'GitHubActions', picked: false, description: 'CI via GitHubActions' },
                    { label: 'GitLabCI', picked: false, description: 'CI via GitLabCI' },
                    { label: 'PkgEvalBadge', picked: false, description: 'Adds a PkgEval badge to the README' },
                    { label: 'RegisterAction', picked: false, description: 'Package registration support' },
                    { label: 'TravisCI', picked: false, description: 'CI via TravisCI' }
                ],
                { canPickMany: true, placeHolder: 'Please select plugins to include in the template.' }
            )
            if (plugins === undefined)
                return
        }
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
                        message = "Would you like to open the new project, or add it to the current workspace?"
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
