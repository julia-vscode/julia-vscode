import * as vscode from 'vscode';
import * as vslc from 'vscode-languageclient';
import * as rpc from 'vscode-jsonrpc';
import { onInit, onExit } from './repl'
import { onSetLanguageClient } from '../extension';
import { TextDocumentPositionParams } from 'vscode-languageclient';

let statusBarItem: vscode.StatusBarItem = null
let g_connection: rpc.MessageConnection = null
let g_languageClient: vslc.LanguageClient = null

const isConnectionActive = () => g_connection !== null
const isLanguageClientActive = () => g_languageClient !== null

const manuallySetDocuments = []

const requestTypeGetModules = new rpc.RequestType<void, string[], void, void>('repl/loadedModules');
const requestTypeIsModuleLoaded = new rpc.RequestType<string, boolean, void, void>('repl/isModuleLoaded');

const automaticallyChooseOption = 'Choose Automatically'


export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(ed => updateStatusBarItem(ed)))
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(changeEvent => updateModuleForSelectionEvent(changeEvent)))
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.chooseModule', chooseModule))

    context.subscriptions.push(onSetLanguageClient(languageClient => {
        g_languageClient = languageClient
    }))

    // NOTE:
    // set module status bar item just right of language mode selector
    // ref: language selector has priority `100`:
    // https://github.com/microsoft/vscode/blob/1d268b701376470bc638100fbe17d283404ac559/src/vs/workbench/browser/parts/editor/editorStatus.ts#L534
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
    statusBarItem.command = 'language-julia.chooseModule'
    statusBarItem.text = 'Main'
    statusBarItem.tooltip = 'Choose Current Module'

    onInit(conn => {
        g_connection = conn
        updateStatusBarItem(vscode.window.activeTextEditor)
    })
    onExit(hadError => {
        g_connection = null
        statusBarItem.hide()
    })

    context.subscriptions.push(statusBarItem)
}

export async function getModuleForEditor(
    editor: vscode.TextEditor = vscode.window.activeTextEditor,
    position: vscode.Position = editor.selection.start
) {
    if (!editor) {
        return 'Main'
    }

    let mod = manuallySetDocuments[editor.document.fileName]

    if (mod === undefined) {
        const params: TextDocumentPositionParams = {
            textDocument: vslc.TextDocumentIdentifier.create(editor.document.uri.toString()),
            position: position
        }

        if (isLanguageClientActive()) {
            mod = await g_languageClient.sendRequest('julia/getModuleAt', params)
        } else {
            mod = 'Main'
        }
    }

    return mod
}

function isJuliaEditor(editor: vscode.TextEditor = vscode.window.activeTextEditor) {
    return editor && editor.document.languageId === 'julia'
}

async function updateStatusBarItem(editor: vscode.TextEditor) {
    if (isConnectionActive() && isJuliaEditor(editor)) {
        statusBarItem.show()
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
    if (isConnectionActive()) {
        loaded = await g_connection.sendRequest(requestTypeIsModuleLoaded, mod)
    }

    statusBarItem.text = loaded ? mod : '(' + mod + ')'
}

export async function selectModule(special = automaticallyChooseOption) {
    const possibleModules = await g_connection.sendRequest(requestTypeGetModules, null)
    possibleModules.sort()
    possibleModules.splice(0, 0, special)
    const qpOptions: vscode.QuickPickOptions = {
        placeHolder: 'Select module',
        canPickMany: false
    }
    return vscode.window.showQuickPick(possibleModules, qpOptions)
}

async function chooseModule() {
    if (!isConnectionActive()) {
        vscode.window.showInformationMessage('Setting a module requires an active REPL.')
        return
    }

    const mod = await selectModule()

    const ed = vscode.window.activeTextEditor;
    if (mod === automaticallyChooseOption) {
        delete manuallySetDocuments[ed.document.fileName]
    } else {
        manuallySetDocuments[ed.document.fileName] = mod
    }

    updateStatusBarItem(ed)
}
