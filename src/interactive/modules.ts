import * as vscode from 'vscode';
import * as vslc from 'vscode-languageclient';

let statusBarItem: vscode.StatusBarItem = null
let g_languageClient: vslc.LanguageClient = null

interface TextDocumentPositionParams {
    textDocument: vslc.TextDocumentIdentifier
    position: vscode.Position
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(ed => updateStatusBarItem(ed)))
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(changeEvent => updateModuleForSelectionEvent(changeEvent)))
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.chooseModule', chooseModule))

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right)
    statusBarItem.command = 'language-julia:chooseModule'
    statusBarItem.text = 'Main'
    statusBarItem.tooltip = 'Choose Current Module'
}

export function setLanguageClient(languageClient) {
    g_languageClient = languageClient
}

export function deactivate() {
    statusBarItem.dispose()
}

function updateStatusBarItem(editor: vscode.TextEditor) {
    if (editor.document.languageId === 'julia') {
        statusBarItem.show()
        
        updateModuleForEditor(editor)
    } else {
        statusBarItem.hide()
    }
}

async function updateModuleForSelectionEvent(event: vscode.TextEditorSelectionChangeEvent) {
    let editor = event.textEditor
    await updateModuleForEditor(editor)
}

async function updateModuleForEditor(editor: vscode.TextEditor) {
    const params: TextDocumentPositionParams = { 
        textDocument: vslc.TextDocumentIdentifier.create(editor.document.uri.toString()), 
        position: new vscode.Position(0, 0)
    }

    let mod: string = await g_languageClient.sendRequest('julia/getModuleAt', params)

    statusBarItem.text = mod
}

async function chooseModule() {
    // FIXME: Need to actually get the modules from the runtime.
    // FIXME: Need to add an `Auto` setting.
    // FIXME: Need to keep track of what `TextDocument`s are manually set.
    
    const possibleModules: string[] = ["Main", "Foo", "Bar"]

    const mod = await vscode.window.showQuickPick(possibleModules, {canPickMany: false})
    console.log(mod);
    
}