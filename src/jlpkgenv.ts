import * as fs from 'async-file'
import { exec } from 'child-process-promise'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import * as vslc from 'vscode-languageclient'
import { onSetLanguageClient } from './extension'
import * as juliaexepath from './juliaexepath'
import * as packagepath from './packagepath'
import * as telemetry from './telemetry'

let g_languageClient: vslc.LanguageClient = null

let g_current_environment: vscode.StatusBarItem = null

let g_path_of_current_environment: string = null
let g_path_of_default_environment: string = null

export async function getProjectFilePaths(envpath: string) {
    const dlext = process.platform === 'darwin' ? 'dylib' : process.platform === 'win32' ? 'dll' : 'so'
    return {
        project_toml_path: (await fs.exists(path.join(envpath, 'JuliaProject.toml'))) ?
            path.join(envpath, 'JuliaProject.toml') :
            (await fs.exists(path.join(envpath, 'Project.toml'))) ? path.join(envpath, 'Project.toml') : undefined,
        manifest_toml_path: (await fs.exists(path.join(envpath, 'JuliaManifest.toml'))) ?
            path.join(envpath, 'JuliaManifest.toml') :
            (await fs.exists(path.join(envpath, 'Manifest.toml'))) ? path.join(envpath, 'Manifest.toml') : undefined,
        sysimage_path: (await fs.exists(path.join(envpath, `JuliaSysimage.${dlext}`))) ? path.join(envpath, `JuliaSysimage.${dlext}`) : undefined
    }
}

async function switchEnvToPath(envpath: string, notifyLS: boolean) {
    g_path_of_current_environment = envpath

    const section = vscode.workspace.getConfiguration('julia')

    const currentConfigValue = section.get<string>('environmentPath')

    if (g_path_of_current_environment !== await getDefaultEnvPath()) {
        if (currentConfigValue !== g_path_of_current_environment) {
            section.update('environmentPath', g_path_of_current_environment, vscode.ConfigurationTarget.Workspace)
        }
    }
    else {
        if (currentConfigValue !== null) {
            section.update('environmentPath', undefined, vscode.ConfigurationTarget.Workspace)
        }
    }

    g_current_environment.text = 'Julia env: ' + await getEnvName()

    if (vscode.workspace.workspaceFolders !== undefined &&
        vscode.workspace.workspaceFolders.length === 1 &&
        vscode.workspace.workspaceFolders[0].uri.fsPath !== g_path_of_current_environment &&
        (await fs.exists(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'Project.toml')) || await fs.exists(path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'JuliaProject.toml')))) {

        const case_adjusted = process.platform === 'win32' ?
            vscode.workspace.workspaceFolders[0].uri.fsPath.charAt(0).toUpperCase() + vscode.workspace.workspaceFolders[0].uri.fsPath.slice(1) :
            vscode.workspace.workspaceFolders[0].uri.fsPath

        const jlexepath = await juliaexepath.getJuliaExePath()
        const res = await exec(`"${jlexepath}" --project=${g_path_of_current_environment} --startup-file=no --history-file=no -e "using Pkg; println(in(ARGS[1], VERSION>=VersionNumber(1,1,0) ? realpath.(filter(i->i!==nothing && isdir(i), getproperty.(values(Pkg.Types.Context().env.manifest), :path))) : realpath.(filter(i->i!=nothing && isdir(i), map(i->get(i[1], string(:path), nothing), values(Pkg.Types.Context().env.manifest)))) ))" "${case_adjusted}"`)

        if (res.stdout.trim() === 'false') {
            vscode.window.showInformationMessage('You opened a Julia package that is not part of your current environment. Do you want to activate a different environment?', 'Change Julia environment')
                .then(env_choice => {
                    if (env_choice === 'Change Julia environment') {
                        changeJuliaEnvironment()
                    }
                })
        }
    }

    if (notifyLS) {
        g_languageClient.sendNotification('julia/activateenvironment', envpath)
    }
}

async function changeJuliaEnvironment() {
    telemetry.traceEvent('changeCurrentEnvironment')

    const optionsEnv: vscode.QuickPickOptions = {
        placeHolder: 'Select environment'
    }

    const depotPaths = await packagepath.getPkgDepotPath()
    const projectNames = ['JuliaProject.toml', 'Project.toml']
    const homeDir = os.homedir()

    const envFolders = [{ label: '(pick a folder)', description: '' }]

    if (vscode.workspace.workspaceFolders) {
        for (const workspaceFolder of vscode.workspace.workspaceFolders) {
            let curPath = workspaceFolder.uri.fsPath.toString()
            while (true) {
                const oldPath = curPath
                for (const projectName of projectNames) {
                    if (await fs.exists(path.join(curPath, projectName))) {
                        envFolders.push({ label: path.basename(curPath), description: curPath })
                        break
                    }
                }
                if (curPath === homeDir) {break}
                curPath = path.dirname(curPath)
                if (oldPath === curPath) {break}
            }
        }
    }

    for (const depotPath of depotPaths) {
        const envFolderForThisDepot = path.join(depotPath, 'environments')

        const folderExists = await fs.exists(envFolderForThisDepot)
        if (folderExists) {
            const envirsForThisDepot = await fs.readdir(envFolderForThisDepot)

            for (const envFolder of envirsForThisDepot) {
                envFolders.push({ label: envFolder, description: path.join(envFolderForThisDepot, envFolder) })
            }
        }
    }

    const resultPackage = await vscode.window.showQuickPick(envFolders, optionsEnv)

    if (resultPackage !== undefined) {
        if (resultPackage.description === '') {
            const resultFolder = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true })
            // Is this actually an environment?
            if (resultFolder !== undefined) {
                const envPathUri = resultFolder[0].toString()
                const envPath = vscode.Uri.parse(envPathUri).fsPath
                const isThisAEnv = await fs.exists(path.join(envPath, 'Project.toml'))
                if (isThisAEnv) {
                    switchEnvToPath(envPath, true)
                }
                else {
                    vscode.window.showErrorMessage('The selected path is not a julia environment.')
                }
            }
        }
        else {
            switchEnvToPath(resultPackage.description, true)
        }
    }
}

async function getDefaultEnvPath() {
    if (g_path_of_default_environment === null) {
        if (vscode.workspace.workspaceFolders) {
            if (vscode.workspace.workspaceFolders.length === 1) {
                const projectFilePath1 = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'JuliaProject.toml')
                const manifestFilePath1 = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'JuliaManifest.toml')
                const projectFilePath2 = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'Project.toml')
                const manifestFilePath2 = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'Manifest.toml')
                if (await fs.exists(projectFilePath1) && await fs.exists(manifestFilePath1)) {
                    return vscode.workspace.workspaceFolders[0].uri.fsPath
                }
                else if (await fs.exists(projectFilePath2) && await fs.exists(manifestFilePath2)) {
                    return vscode.workspace.workspaceFolders[0].uri.fsPath
                }
            }
        }

        const jlexepath = await juliaexepath.getJuliaExePath()
        const res = await exec(`"${jlexepath}" --startup-file=no --history-file=no -e "using Pkg; println(dirname(Pkg.Types.Context().env.project_file))"`)
        g_path_of_default_environment = res.stdout.trim()
    }
    return g_path_of_default_environment
}

export async function getEnvPath() {
    if (g_path_of_current_environment === null) {
        const section = vscode.workspace.getConfiguration('julia')
        const envPathConfig = section.get<string>('environmentPath')
        if (envPathConfig !== null) {
            g_path_of_current_environment = envPathConfig
        }
        else {
            g_path_of_current_environment = await getDefaultEnvPath()
        }
    }
    return g_path_of_current_environment
}

export async function getEnvName() {
    const envpath = await getEnvPath()
    return path.basename(envpath)
}

export async function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(onSetLanguageClient(languageClient => {
        g_languageClient = languageClient
    }))

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.changeCurrentEnvironment', changeJuliaEnvironment))
    // Environment status bar
    g_current_environment = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)
    g_current_environment.show()
    g_current_environment.text = 'Julia env: [loading]'
    g_current_environment.command = 'language-julia.changeCurrentEnvironment'
    context.subscriptions.push(g_current_environment)
    await switchEnvToPath(await getEnvPath(), false) // We don't need to notify the LS here because it will start with that env already
}
