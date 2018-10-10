import * as vscode from 'vscode';
import * as settings from './settings';
import * as vslc from 'vscode-languageclient';
import * as telemetry from './telemetry';
import * as fs from 'async-file';
import * as packagepath from './packagepath'
import * as path from 'path'

let g_context: vscode.ExtensionContext = null;
let g_settings: settings.ISettings = null;
let g_languageClient: vslc.LanguageClient = null;

let g_current_environment: vscode.StatusBarItem = null;

let g_path_of_current_environment: string = null;
let g_name_of_current_environment: string = null;

function switchEnvToPath(envpath: string) {
    g_path_of_current_environment = envpath;
    g_name_of_current_environment = path.basename(g_path_of_current_environment);
    g_current_environment.text = g_name_of_current_environment;        

}

async function changeJuliaEnvironment() {
    telemetry.traceEvent('changeCurrentEnvironment');

    const optionsEnv: vscode.QuickPickOptions = {
        placeHolder: 'Select environment'
    };

    let depotPaths = await packagepath.getPkgDepotPath();

    let envFolders = [{label: '(pick a folder)', description: ''}];

    for (let depotPath of depotPaths) {
        let envFolderForThisDepot = path.join(depotPath, 'environments');

        let folderExists = await fs.exists(envFolderForThisDepot);
        if (folderExists) {
            let envirsForThisDepot = await fs.readdir(envFolderForThisDepot);
            
            for (let envFolder of envirsForThisDepot) {
                envFolders.push({label: envFolder, description: path.join(envFolderForThisDepot, envFolder)});
            }            
        }
    }

    let resultPackage = await vscode.window.showQuickPick(envFolders, optionsEnv);

    if (resultPackage!==undefined) {
        if (resultPackage.description=='') {
            let resultFolder = await vscode.window.showOpenDialog({canSelectFiles: false, canSelectFolders: true});
            // Is this actually an environment?
            if (resultFolder!==undefined) {
                let envPath = resultFolder[0].toString();
                let isThisAEnv = await fs.exists(path.join(envPath, 'Project.toml'));
                if (isThisAEnv) {
                    
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

export function getEnvPath() {
    return g_path_of_current_environment;
}

export function activate(context: vscode.ExtensionContext, settings: settings.ISettings) {
    g_context = context;
    g_settings = settings;

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.changeCurrentEnvironment', changeJuliaEnvironment));

    // Environment status bar
    g_current_environment = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    g_current_environment.show();
    g_current_environment.text = "Julia env: v1.0";
    g_current_environment.command = "language-julia.changeCurrentEnvironment";
    context.subscriptions.push(g_current_environment);

}

export function onDidChangeConfiguration(newSettings: settings.ISettings) {

}

export function onNewLanguageClient(newLanguageClient: vslc.LanguageClient) {
    g_languageClient = newLanguageClient;
}
