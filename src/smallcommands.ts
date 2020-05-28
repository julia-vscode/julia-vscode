import * as vscode from 'vscode';
import * as settings from './settings'
import * as vslc from 'vscode-languageclient';
import * as telemetry from './telemetry';
import { onSetLanguageClient, onDidChangeConfig } from './extension';
import { ContextTagKeys } from 'applicationinsights/out/Declarations/Contracts';

let g_context: vscode.ExtensionContext = null;
let g_settings: settings.ISettings = null;
let g_languageClient: vslc.LanguageClient = null;

function toggleLinter() {
    telemetry.traceEvent('command-togglelinter');

    let cval = vscode.workspace.getConfiguration('julia').get('lint.run', false)
    vscode.workspace.getConfiguration('julia').update('lint.run', !cval, true)
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

export function activate(context: vscode.ExtensionContext, settings: settings.ISettings) {
    g_context = context;
    g_settings = settings;

    context.subscriptions.push(onSetLanguageClient(languageClient => {
        g_languageClient = languageClient
    }))
    context.subscriptions.push(onDidChangeConfig(newSettings => {}))

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.applytextedit', applyTextEdit));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.toggleLinter', toggleLinter));
}
