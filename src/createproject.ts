import * as path from 'path'
import * as vscode from 'vscode'
import { JuliaExecutablesFeature } from './juliaexepath'
import { registerCommand } from './utils'

export class JuliaNewProjectFeature {
    constructor(private context: vscode.ExtensionContext, private juliaExecutablesFeature: JuliaExecutablesFeature) {
        this.context.subscriptions.push(registerCommand('language-julia.createNewProject', () => this.createNewProject()))
    }

    private async createNewProject() {

        const pkgName = await vscode.window.showInputBox({ prompt: 'Please enter the name of the project to create.' })
        if (!pkgName)
            return // TODO: Show cancellation message

        const authors = await vscode.window.showInputBox({ prompt: 'Please enter the authors of the project', placeHolder: "Default uses 'github.name' and 'github.email' from the global Git config." })
        if (authors === undefined)
            return // TODO: Show cancellation message

        let host = await vscode.window.showQuickPick(['github.com', 'gitlab.com', 'bitbucket.org', 'Other'], { placeHolder: 'The URL to the code hosting service where the project will reside.' })
        if (host === 'Other') {
            host = await vscode.window.showInputBox({ prompt: 'Please enter the URL to the code hosting service.' })
        }
        if (host === undefined)
            return // TODO: Show cancellation message

        const user = await vscode.window.showInputBox({ prompt: 'Please enter your username.', placeHolder: "Default is 'github.user' from the global Git config." })
        if (user === undefined)
            return // TODO: Show cancellation message

        let juliaVersion = await vscode.window.showQuickPick(
            ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', 'Other'],
            { placeHolder: 'Please select the minimum allowed Julia version.' }
        )
        if (juliaVersion === 'Other') {
            juliaVersion = await vscode.window.showInputBox({ prompt: 'Please enter the minimum allowed Julia version.'})
        }
        if (juliaVersion === undefined)
            return // TODO: Show cancellation message

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
            return // TODO: Show cancellation message

        const directory = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select Project Location'
        })
        if (!directory)
            return // TODO: Show cancellation message

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
                    JULIA_PROJECT: path.join(this.context.extensionPath, 'scripts', 'environments', 'pkgdev')
                },

            }
        )

        newTerm.show(true)
    }

    public dispose() { }
}
