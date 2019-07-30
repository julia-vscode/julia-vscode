import * as vscode from 'vscode';
import * as settings from './settings'
import * as vslc from 'vscode-languageclient';
import * as telemetry from './telemetry';

let g_context: vscode.ExtensionContext = null;
let g_settings: settings.ISettings = null;
let g_languageClient: vslc.LanguageClient = null;

function toggleLinter() {
    telemetry.traceEvent('command-togglelinter');

    let cval = vscode.workspace.getConfiguration('julia').get('runLinter', false)
    vscode.workspace.getConfiguration('julia').update('runLinter', !cval, true)
}

function applyTextEdit(we) {
    telemetry.traceEvent('command-applytextedit');

    let wse = new vscode.WorkspaceEdit()
    for (let edit of we.documentChanges[0].edits) {
        wse.replace(we.documentChanges[0].textDocument.uri, new vscode.Range(edit.range.start.line, edit.range.start.character, edit.range.end.line, edit.range.end.character), edit.newText)
    }
    vscode.workspace.applyEdit(wse)
}

// function lintPackage() {
//     telemetry.traceEvent('command-lintpackage');

//     if (g_languageClient == null) {
//         vscode.window.showErrorMessage('Error: package linting only works with a running julia language server.');
//     }
//     else {
//         try {
//             g_languageClient.sendRequest("julia/lint-package");
//         }
//         catch (ex) {
//             if (ex.message == "Language client is not ready yet") {
//                 vscode.window.showErrorMessage('Error: package linting only works with a running julia language server.');
//             }
//             else {
//                 throw ex;
//             }
//         }
//     }
// }


function toggleServerLogs() {
    telemetry.traceEvent('command-juliatogglelog');

    if (g_languageClient == null) {
        vscode.window.showErrorMessage('Error: Lanuage server is not yet running.');
    }
    else {
        try {
            g_languageClient.sendRequest("julia/toggle-log");
        }
        catch (ex) {
            if (ex.message == "Language client is not ready yet") {
                vscode.window.showErrorMessage('Error: server is not running.');
            }
            else {
                throw ex;
            }
        }
    }
}

function toggleFileLint(arg) {
    telemetry.traceEvent('command-juliatogglefilelint');

    if (g_languageClient == null) {
        vscode.window.showErrorMessage('Error: Lanuage server is not yet running.');
    }
    else {
        try {
            g_languageClient.sendRequest("julia/toggleFileLint", arg);
        }
        catch (ex) {
            5
            if (ex.message == "Language client is not ready yet") {
                vscode.window.showErrorMessage('Error: server is not running.');
            }
            else {
                throw ex;
            }
        }
    }
}

async function openJuliaHelp() {
    let searchString = await vscode.window.showInputBox()
    if (g_languageClient == null) {
        vscode.window.showErrorMessage('Error: Lanuage server is not yet running.');
    }
    else {
        try {
            g_languageClient.sendRequest("julia/help", searchString).then((v :string)=>{
                vscode.window.showInformationMessage(v)
            });
        }
        catch (ex) {
            5
            if (ex.message == "Language client is not ready yet") {
                vscode.window.showErrorMessage('Error: server is not running.');
            }
            else {
                throw ex;
            }
        }
    }
}

export function activate(context: vscode.ExtensionContext, settings: settings.ISettings) {
    g_context = context;
    g_settings = settings;

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.applytextedit', applyTextEdit));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.toggleLinter', toggleLinter));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.toggle-log', toggleServerLogs));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.toggle-file-lint', toggleFileLint));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.help', openJuliaHelp));
}

export function onDidChangeConfiguration(newSettings: settings.ISettings) {

}

export function onNewLanguageClient(newLanguageClient: vslc.LanguageClient) {
    g_languageClient = newLanguageClient;
}
