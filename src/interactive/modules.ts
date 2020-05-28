import * as vscode from 'vscode';
import * as vslc from 'vscode-languageclient';
import * as rpc from 'vscode-jsonrpc';
import { onInit, onExit } from './repl'

let statusBarItem: vscode.StatusBarItem = null
let g_connection: rpc.MessageConnection = null
let g_languageClient: vslc.LanguageClient = null

interface TextDocumentPositionParams {
    textDocument: vslc.TextDocumentIdentifier
    position: vscode.Position
}

const manuallySetDocuments = []

const requestTypeGetModules = new rpc.RequestType<{}, string[], void, void>('repl/loadedModules');
const requestTypeIsModuleLoaded = new rpc.RequestType<{
    module: string
}, boolean, void, void>('repl/isModuleLoaded');

const automaticallyChooseOption = 'Choose Automatically'


export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(ed => updateStatusBarItem(ed)))
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(changeEvent => updateModuleForSelectionEvent(changeEvent)))
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.chooseModule', chooseModule))

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right)
    statusBarItem.command = 'language-julia.chooseModule'
    statusBarItem.text = 'Main'
    statusBarItem.tooltip = 'Choose Current Module'

    onInit(conn => {
        g_connection = conn
        const editor = vscode.window.activeTextEditor
        if (isJuliaEditor(editor)) {
            statusBarItem.show()
            updateModuleForEditor(editor)
        }
    })
    onExit(hadError => {
        g_connection = null
        statusBarItem.hide()
    })
}

export function setLanguageClient(languageClient) {
    g_languageClient = languageClient
}

export async function getModuleForEditor(editor: vscode.TextEditor, position: vscode.Position =  editor.selection.start) {
    let mod = manuallySetDocuments[editor.document.fileName]

    if (mod === undefined) {
        const params: TextDocumentPositionParams = {
            textDocument: vslc.TextDocumentIdentifier.create(editor.document.uri.toString()),
            position: position
        }

        if (g_languageClient) {
            mod = await g_languageClient.sendRequest('julia/getModuleAt', params)
        } else {
            mod = 'Main'
        }
    }

    return mod
}

export function deactivate() {
    statusBarItem.dispose()
}

function isJuliaEditor(editor: vscode.TextEditor) {
    return editor && editor.document && editor.document.languageId === 'julia'
}

async function updateStatusBarItem(editor: vscode.TextEditor) {
    if (isJuliaEditor(editor)) {
        await updateModuleForEditor(editor)
    } else {
        statusBarItem.hide()
    }
}

async function updateModuleForSelectionEvent(event: vscode.TextEditorSelectionChangeEvent) {
    let editor = event.textEditor
    await updateStatusBarItem(editor)
}

async function updateModuleForEditor(editor: vscode.TextEditor) {
    const mod = await getModuleForEditor(editor)

    let loaded = false
    if (g_connection !== null) {
        loaded = await g_connection.sendRequest(requestTypeIsModuleLoaded, {
            module: mod
        })
    }

    statusBarItem.text = loaded ? mod : '(' + mod + ')'
}

async function chooseModule() {
    if (g_connection === null) {
        vscode.window.showInformationMessage('Setting a module requires an active REPL.')
        return
    }

    const possibleModules = await g_connection.sendRequest(requestTypeGetModules, {})

    possibleModules.sort()
    possibleModules.splice(0, 0, automaticallyChooseOption)

    const qpOptions: vscode.QuickPickOptions = {
        placeHolder: 'Select module',
        canPickMany: false
    }
    const mod = await vscode.window.showQuickPick(possibleModules, qpOptions)

    const ed = vscode.window.activeTextEditor;
    if (mod === automaticallyChooseOption) {
        delete manuallySetDocuments[ed.document.fileName]
    } else {
        manuallySetDocuments[ed.document.fileName] = mod
    }

    updateStatusBarItem(ed)
}
