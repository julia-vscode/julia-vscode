import * as vscode from 'vscode';
import * as fs from 'async-file';
import * as path from 'path';
import * as settings from './settings';
import * as packagepath from './packagepath'
import * as vslc from 'vscode-languageclient';

let g_context: vscode.ExtensionContext = null;
let g_settings: settings.ISettings = null;
let g_languageClient: vslc.LanguageClient = null;

// This method implements the language-julia.openPackageDirectory command
async function openPackageDirectoryCommand() {
    const optionsPackage: vscode.QuickPickOptions = {
        placeHolder: 'Select package'
    };

    try {
        var juliaVersionHomeDir = await packagepath.getPkgPath();

        let files = await fs.readdir(juliaVersionHomeDir);

        let filteredPackages = files.filter(path => !path.startsWith('.') && ['METADATA', 'REQUIRE', 'META_BRANCH'].indexOf(path) < 0);

        if (filteredPackages.length == 0) {
            vscode.window.showInformationMessage('Error: There are no packages installed.');
        }
        else {
            let resultPackage = await vscode.window.showQuickPick(filteredPackages, optionsPackage);

            if (resultPackage !== undefined) {
                var folder = vscode.Uri.file(path.join(juliaVersionHomeDir, resultPackage));

                try {
                    await vscode.commands.executeCommand('vscode.openFolder', folder, true);
                }
                catch (e) {
                    vscode.window.showInformationMessage('Could not open the package.');
                }
            }
        }
    }
    catch (e) {
        vscode.window.showInformationMessage('Error: Could not read package directory.');
    }
}

export function activate(context: vscode.ExtensionContext, settings: settings.ISettings) {
    g_context = context;
    g_settings = settings;

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.openPackageDirectory', openPackageDirectoryCommand));
}

export function onDidChangeConfiguration(newSettings: settings.ISettings) {

}

export function onNewLanguageClient(newLanguageClient: vslc.LanguageClient) {
    g_languageClient = newLanguageClient;
}
