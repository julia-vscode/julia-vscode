import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc'
import { ResponseError } from 'vscode-jsonrpc'
import * as vslc from 'vscode-languageclient/node'
import { onSetLanguageClient, supportedSchemes } from '../extension'
import * as telemetry from '../telemetry'
import { registerCommand, wrapCrashReporting } from '../utils'
import { VersionedTextDocumentPositionParams } from './misc'
import { onExit, onInit } from './repl'

let statusBarItem: vscode.StatusBarItem = null
let g_connection: rpc.MessageConnection = null
let g_languageClient: vslc.LanguageClient = null
let g_currentGetModuleRequestCancelTokenSource: vscode.CancellationTokenSource = null

const manuallySetDocuments = []

const requestTypeGetModules = new rpc.RequestType<void, string[], void>('repl/loadedModules')
const requestTypeIsModuleLoaded = new rpc.RequestType<{ mod: string }, boolean, void>('repl/isModuleLoaded')

const automaticallyChooseOption = 'Choose Automatically'


export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(ed => {
        cancelCurrentGetModuleRequest()
        g_currentGetModuleRequestCancelTokenSource = new vscode.CancellationTokenSource()
        updateStatusBarItem(ed, g_currentGetModuleRequestCancelTokenSource.token)
    }))
    context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(changeEvent => {
        cancelCurrentGetModuleRequest()
        g_currentGetModuleRequestCancelTokenSource = new vscode.CancellationTokenSource()
        updateModuleForSelectionEvent(changeEvent, g_currentGetModuleRequestCancelTokenSource.token)
    }))
    context.subscriptions.push(registerCommand('language-julia.chooseModule', chooseModule))

    context.subscriptions.push(onSetLanguageClient(languageClient => {
        g_languageClient = languageClient
    }))

    // NOTE:
    // set module status bar item just right of language mode selector
    // ref: language selector has priority `100`:
    // https://github.com/microsoft/vscode/blob/1d268b701376470bc638100fbe17d283404ac559/src/vs/workbench/browser/parts/editor/editorStatus.ts#L534
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
    statusBarItem.command = 'language-julia.chooseModule'
    statusBarItem.tooltip = 'Choose Current Module'

    onInit(wrapCrashReporting(conn => {
        g_connection = conn
        updateStatusBarItem()
    }))
    onExit(hadError => {
        g_connection = null
        updateStatusBarItem()
    })

    context.subscriptions.push(statusBarItem)
    updateStatusBarItem()
}

function cancelCurrentGetModuleRequest() {
    if (g_currentGetModuleRequestCancelTokenSource) {
        g_currentGetModuleRequestCancelTokenSource.cancel()
        g_currentGetModuleRequestCancelTokenSource = undefined
    }
}

export async function getModuleForEditor(document: vscode.TextDocument, position: vscode.Position, token?: vscode.CancellationToken): Promise<string> {
    const manuallySetModule = manuallySetDocuments[document.fileName]
    if (manuallySetModule) { return manuallySetModule }

    if (supportedSchemes.findIndex(i => i === document.uri.scheme) === -1) { return 'Main' }

    const languageClient = g_languageClient

    if (!languageClient || !languageClient.isRunning()) { return 'Main' }

    const params: VersionedTextDocumentPositionParams = {
        textDocument: vslc.TextDocumentIdentifier.create(document.uri.toString()),
        version: document.version,
        position: position
    }

    for (let i = 0; i < 3; i++) {
        if (token === undefined || !token.isCancellationRequested) {
            try {
                return await languageClient.sendRequest<string>('julia/getModuleAt', params)
            }
            catch (err) {
                if (err instanceof ResponseError && err.code===rpc.ErrorCodes.ConnectionInactive) {
                    return 'Main'
                }
                else if (err instanceof ResponseError && err.code===-33101) {
                    // This is a version out of sync situation
                    return 'Main'
                }
                else {
                    throw err
                }
            }
        }
        else {
            // We were canceled, so we give up
            return 'Main'
        }
    }

    // We tried three times, now give up
    return 'Main'
}

function isJuliaEditor(editor: vscode.TextEditor = vscode.window.activeTextEditor) {
    return editor && editor.document.languageId === 'julia'
}

async function updateStatusBarItem(editor: vscode.TextEditor = vscode.window.activeTextEditor, token?: vscode.CancellationToken) {
    if (isJuliaEditor(editor)) {
        statusBarItem.show()
        await updateModuleForEditor(editor, token)
    } else {
        statusBarItem.hide()
    }
}

async function updateModuleForSelectionEvent(event: vscode.TextEditorSelectionChangeEvent, token?: vscode.CancellationToken) {
    const editor = event.textEditor
    await updateStatusBarItem(editor, token)
}

async function updateModuleForEditor(editor: vscode.TextEditor, token?: vscode.CancellationToken) {
    const mod = await getModuleForEditor(editor.document, editor.selection.start, token)
    if (mod) {
        const loaded = await isModuleLoaded(mod)
        statusBarItem.text = loaded ? mod : '(' + mod + ')'
    }
}

async function isModuleLoaded(mod: string) {
    if (!g_connection) { return false }
    try {
        return await g_connection.sendRequest(requestTypeIsModuleLoaded, { mod: mod })
    } catch (err) {
        if (g_connection) {
            telemetry.handleNewCrashReportFromException(err, 'Extension')
        }
        return false
    }
}

async function chooseModule() {
    let possibleModules = []
    try {
        possibleModules = await g_connection.sendRequest(requestTypeGetModules, null)
    } catch (err) {
        if (g_connection) {
            telemetry.handleNewCrashReportFromException(err, 'Extension')
        } else {
            vscode.window.showInformationMessage('Setting a module requires an active REPL.')
        }
        return
    }

    possibleModules.sort()
    possibleModules.splice(0, 0, automaticallyChooseOption)

    const qpOptions: vscode.QuickPickOptions = {
        placeHolder: 'Select module',
        canPickMany: false
    }
    const mod = await vscode.window.showQuickPick(possibleModules, qpOptions)

    const ed = vscode.window.activeTextEditor
    if (mod === automaticallyChooseOption) {
        delete manuallySetDocuments[ed.document.fileName]
    } else {
        manuallySetDocuments[ed.document.fileName] = mod
    }

    cancelCurrentGetModuleRequest()
    g_currentGetModuleRequestCancelTokenSource = new vscode.CancellationTokenSource()
    updateStatusBarItem(ed, g_currentGetModuleRequestCancelTokenSource.token)
}
