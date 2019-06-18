import * as vscode from 'vscode';
import * as settings from './settings';
import * as vslc from 'vscode-languageclient';
import * as telemetry from './telemetry';
import * as fs from 'async-file';
import * as packagepath from './packagepath'
import * as os from 'os';
import * as path from 'path'
import * as juliaexepath from './juliaexepath';
var exec = require('child-process-promise').exec;

let g_context: vscode.ExtensionContext = null;
let g_settings: settings.ISettings = null;
let g_languageClient: vslc.LanguageClient = null;

let g_current_environment: vscode.StatusBarItem = null;

let g_path_of_current_environment: string = null;
let g_path_of_default_environment: string = null;

export async function getProjectFilePaths(envpath: string) {
    let dlext = process.platform == 'darwin' ? 'dylib' : process.platform == 'win32' ? 'dll': 'so';
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

async function switchEnvToPath(envpath: string) {
    g_path_of_current_environment = envpath;

    let section = vscode.workspace.getConfiguration('julia');

    let currentConfigValue = section.get<string>('environmentPath')

    if (g_path_of_current_environment!=await getDefaultEnvPath()) {
        if (currentConfigValue!=g_path_of_current_environment) {
            section.update('environmentPath', g_path_of_current_environment, vscode.ConfigurationTarget.Workspace);
        }
    }
    else {
        if (currentConfigValue!=null) {
            section.update('environmentPath', undefined, vscode.ConfigurationTarget.Workspace);
        }
    }

    g_current_environment.text = "Julia env: " + await getEnvName();

    if (vscode.workspace.workspaceFolders!==undefined &&
        vscode.workspace.workspaceFolders.length==1 &&
        vscode.workspace.workspaceFolders[0].uri.fsPath != g_path_of_current_environment) {

        let case_adjusted = process.platform == "win32" ?
            vscode.workspace.workspaceFolders[0].uri.fsPath.charAt(0).toUpperCase() + vscode.workspace.workspaceFolders[0].uri.fsPath.slice(1) :
            vscode.workspace.workspaceFolders[0].uri.fsPath;

        let jlexepath = await juliaexepath.getJuliaExePath();
        var res = await exec(`"${jlexepath}" --project=${g_path_of_current_environment} --startup-file=no --history-file=no -e "using Pkg; println(in(ARGS[1], VERSION>=VersionNumber(1,1,0) ? realpath.(filter(i->i!==nothing, getproperty.(values(Pkg.Types.Context().env.manifest), :path))) : realpath.(filter(i->i!=nothing, map(i->get(i[1], string(:path), nothing), values(Pkg.Types.Context().env.manifest)))) ))" "${case_adjusted}"`);

        if (res.stdout.trim()=="false") {
            vscode.window.showInformationMessage("You opened a Julia package that is not part of your current environment. Do you want to activate a different environment?", 'Change Julia environment')
                .then(env_choice => {
                    if (env_choice == "Change Julia environment") {
                            changeJuliaEnvironment();
                    }
                });
        }
    }

    g_languageClient.sendNotification("julia/activateenvironment", envpath);
}

async function changeJuliaEnvironment() {
    telemetry.traceEvent('changeCurrentEnvironment');

    const optionsEnv: vscode.QuickPickOptions = {
        placeHolder: 'Select environment'
    };

    const depotPaths = await packagepath.getPkgDepotPath();
    const projectNames = ['JuliaProject.toml', 'Project.toml'];
    const homeDir = os.homedir();

    let envFolders = [{ label: '(pick a folder)', description: '' }];

    if (vscode.workspace.workspaceFolders) {
        for (let workspaceFolder of vscode.workspace.workspaceFolders) {
            let curPath = workspaceFolder.uri.fsPath.toString();
            while (true) {
                let oldPath = curPath;
                for (let projectName of projectNames) {
                    if (await fs.exists(path.join(curPath, projectName))) {
                        envFolders.push({ label: path.basename(curPath), description: curPath });
                        break;
                    }
                }
                if (curPath == homeDir) break;
                curPath = path.dirname(curPath);
                if (oldPath == curPath) break;
            }
        }
    }

    for (let depotPath of depotPaths) {
        let envFolderForThisDepot = path.join(depotPath, 'environments');

        let folderExists = await fs.exists(envFolderForThisDepot);
        if (folderExists) {
            let envirsForThisDepot = await fs.readdir(envFolderForThisDepot);

            for (let envFolder of envirsForThisDepot) {
                envFolders.push({ label: envFolder, description: path.join(envFolderForThisDepot, envFolder) });
            }
        }
    }

    let resultPackage = await vscode.window.showQuickPick(envFolders, optionsEnv);

    if (resultPackage !== undefined) {
        if (resultPackage.description == '') {
            let resultFolder = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true });
            // Is this actually an environment?
            if (resultFolder !== undefined) {
                let envPathUri = resultFolder[0].toString();
                let envPath = vscode.Uri.parse(envPathUri).fsPath;
                let isThisAEnv = await fs.exists(path.join(envPath, 'Project.toml'));
                if (isThisAEnv) {
                    switchEnvToPath(envPath);
                }
                else {
                    vscode.window.showErrorMessage('The selected path is not a julia environment.');
                }
            }
        }
        else {
            switchEnvToPath(resultPackage.description);
        }
    }
}

async function getDefaultEnvPath() {
    if (g_path_of_default_environment == null) {
        if (vscode.workspace.workspaceFolders) {
            if (vscode.workspace.workspaceFolders.length == 1) {
                let projectFilePath1 = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'JuliaProject.toml');
                let manifestFilePath1 = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'JuliaManifest.toml');
                let projectFilePath2 = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'Project.toml');
                let manifestFilePath2 = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'Manifest.toml');
                if (await fs.exists(projectFilePath1) && await fs.exists(manifestFilePath1)) {
                    return vscode.workspace.workspaceFolders[0].uri.fsPath
                }
                else if (await fs.exists(projectFilePath2) && await fs.exists(manifestFilePath2)) {
                    return vscode.workspace.workspaceFolders[0].uri.fsPath
                }
            }
        }

        let jlexepath = await juliaexepath.getJuliaExePath();
        var res = await exec(`"${jlexepath}" --startup-file=no --history-file=no -e "using Pkg; println(dirname(Pkg.Types.Context().env.project_file))"`);
        g_path_of_default_environment = res.stdout.trim();
    }
    return g_path_of_default_environment
}

export async function getEnvPath() {
    if (g_path_of_current_environment == null) {
        let section = vscode.workspace.getConfiguration('julia');
        let envPathConfig = section.get<string>("environmentPath");
        if (envPathConfig!==null){
            g_path_of_current_environment = envPathConfig;
        }
        else {
            g_path_of_current_environment = await getDefaultEnvPath();
        }
    }
    return g_path_of_current_environment;
}

export async function getEnvName() {
    let envpath = await getEnvPath();
    return path.basename(envpath);
}

export async function activate(context: vscode.ExtensionContext, settings: settings.ISettings) {
    g_context = context;
    g_settings = settings;
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.changeCurrentEnvironment', changeJuliaEnvironment));
    // Environment status bar
    g_current_environment = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    g_current_environment.show();
    g_current_environment.text = "Julia env: [loading]";
    g_current_environment.command = "language-julia.changeCurrentEnvironment";
    context.subscriptions.push(g_current_environment);
    await switchEnvToPath(await getEnvPath());
}

export function onDidChangeConfiguration(newSettings: settings.ISettings) {
}

export function onNewLanguageClient(newLanguageClient: vslc.LanguageClient) {
    g_languageClient = newLanguageClient;
}
