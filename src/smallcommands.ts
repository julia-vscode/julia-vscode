import * as fs from 'async-file'
import * as path from 'path'
import * as vscode from 'vscode'
import * as telemetry from './telemetry'
import { registerCommand } from './utils'

function toggleLinter() {
    telemetry.traceEvent('command-togglelinter')

    const cval = vscode.workspace.getConfiguration('julia').get('lint.run', false)
    vscode.workspace.getConfiguration('julia').update('lint.run', !cval, vscode.ConfigurationTarget.Global)
}

function applyTextEdit(we) {
    telemetry.traceEvent('command-applytextedit')

    const wse = new vscode.WorkspaceEdit()
    for (const edit of we.documentChanges[0].edits) {
        wse.replace(
            we.documentChanges[0].textDocument.uri,
            new vscode.Range(
                edit.range.start.line,
                edit.range.start.character,
                edit.range.end.line,
                edit.range.end.character
            ),
            edit.newText
        )
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

async function newJuliaFile(uri?: vscode.Uri) {
    if (uri) {
        const stat = await vscode.workspace.fs.stat(uri)
        const dir = stat.type === vscode.FileType.Directory ? uri.fsPath : path.dirname(uri.fsPath)
        const defaultName = path.join(dir, 'untitled.jl')
        const givenPath = await vscode.window.showInputBox({
            value: defaultName,
            valueSelection: [dir.length + 1, defaultName.length - 3], // select file name
            prompt: 'Enter a file path to be created',
            validateInput: async (input) => {
                const givenPath = vscode.Uri.file(input).fsPath
                const exist = await fs.exists(givenPath)
                if (exist) {
                    return `${givenPath} already exists`
                }
                const givenDir = path.dirname(givenPath)
                const dirExist = await fs.exists(givenDir)
                if (!dirExist) {
                    return `Directory ${givenDir} doesn't exist`
                }
                return undefined // valid
            },
        })
        if (!givenPath) {
            return
        } // canceled, etc
        const targetUri = vscode.Uri.file(givenPath)
        try {
            await fs.writeTextFile(targetUri.fsPath, '')
            const document = await vscode.workspace.openTextDocument(targetUri)
            await vscode.languages.setTextDocumentLanguage(document, 'julia')
            await vscode.window.showTextDocument(document)
        } catch {
            vscode.window.showErrorMessage(`Failed to create ${targetUri.fsPath}`)
        }
    } else {
        // untitled editor
        const document = await vscode.workspace.openTextDocument({
            language: 'julia',
        })
        await vscode.window.showTextDocument(document)
    }
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        registerCommand('language-julia.applytextedit', applyTextEdit),
        registerCommand('language-julia.toggleLinter', toggleLinter),
        registerCommand('language-julia.newJuliaFile', newJuliaFile)
    )
}
