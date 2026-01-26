import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc'
import { ResponseError } from 'vscode-jsonrpc'
import * as vslc from 'vscode-languageclient/node'
import { LanguageClientFeature, supportedSchemes } from '../languageClient'
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

export function activate(context: vscode.ExtensionContext, languageClientFeature: LanguageClientFeature) {
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor((ed) => {
            cancelCurrentGetModuleRequest()
            g_currentGetModuleRequestCancelTokenSource = new vscode.CancellationTokenSource()
            updateStatusBarItem(ed, g_currentGetModuleRequestCancelTokenSource.token)
        })
    )
    context.subscriptions.push(
        vscode.window.onDidChangeTextEditorSelection((changeEvent) => {
            cancelCurrentGetModuleRequest()
            g_currentGetModuleRequestCancelTokenSource = new vscode.CancellationTokenSource()
            updateModuleForSelectionEvent(changeEvent, g_currentGetModuleRequestCancelTokenSource.token)
        })
    )
    context.subscriptions.push(registerCommand('language-julia.chooseModule', chooseModule))

    context.subscriptions.push(
        languageClientFeature.onDidSetLanguageClient((languageClient) => {
            g_languageClient = languageClient
        })
    )

    // NOTE:
    // set module status bar item just right of language mode selector
    // ref: language selector has priority `100`:
    // https://github.com/microsoft/vscode/blob/1d268b701376470bc638100fbe17d283404ac559/src/vs/workbench/browser/parts/editor/editorStatus.ts#L534
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99)
    statusBarItem.command = 'language-julia.chooseModule'
    statusBarItem.tooltip = 'Choose Current Module'

    onInit(
        wrapCrashReporting(({ connection: conn }) => {
            g_connection = conn
            updateStatusBarItem()
        })
    )
    onExit(() => {
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

interface SelectedModule {
    module: string
    global?: boolean
    manual?: boolean
}

export async function getModuleForEditor(
    document: vscode.TextDocument,
    position: vscode.Position,
    token?: vscode.CancellationToken
): Promise<SelectedModule> {
    const manuallySetModule = manuallySetDocuments[document.fileName]
    if (manuallySetModule) {
        return {
            module: manuallySetModule,
            manual: true,
        }
    }

    const globalModule: string = vscode.workspace.getConfiguration('julia.execution').get('module')

    if (globalModule) {
        return {
            module: globalModule,
            global: true,
        }
    }

    if (supportedSchemes.findIndex((i) => i === document.uri.scheme) === -1) {
        return {
            module: 'Main',
        }
    }

    const languageClient = g_languageClient

    if (!languageClient || !languageClient.isRunning()) {
        return { module: 'Main' }
    }

    const params: VersionedTextDocumentPositionParams = {
        textDocument: vslc.TextDocumentIdentifier.create(document.uri.toString()),
        version: document.version,
        position: position,
    }

    if (token === undefined || !token.isCancellationRequested) {
        try {
            return { module: await languageClient.sendRequest<string>('julia/getModuleAt', params) }
        } catch (err) {
            if ((err as ResponseError).code && err.code === rpc.ErrorCodes.ConnectionInactive) {
                return { module: 'Main' }
            } else if ((err as ResponseError).code && err.code === -33101) {
                // This is a version out of sync situation
                return { module: 'Main' }
            } else {
                throw err
            }
        }
    } else {
        return { module: 'Main' }
    }
}

function isJuliaEditor(editor: vscode.TextEditor = vscode.window.activeTextEditor) {
    return editor && editor.document.languageId === 'julia'
}

async function updateStatusBarItem(
    editor: vscode.TextEditor = vscode.window.activeTextEditor,
    token?: vscode.CancellationToken
) {
    if (isJuliaEditor(editor)) {
        statusBarItem.show()
        await updateModuleForEditor(editor, token)
    } else {
        statusBarItem.hide()
    }
}

async function updateModuleForSelectionEvent(
    event: vscode.TextEditorSelectionChangeEvent,
    token?: vscode.CancellationToken
) {
    const editor = event.textEditor
    await updateStatusBarItem(editor, token)
}

async function updateModuleForEditor(editor: vscode.TextEditor, token?: vscode.CancellationToken) {
    const { module, manual, global } = await getModuleForEditor(editor.document, editor.selection.start, token)
    if (module) {
        const loaded = await isModuleLoaded(module)
        let suffix = ''
        if (manual) {
            suffix = ' (manual)'
        } else if (global) {
            suffix = ' (global)'
        }
        statusBarItem.text = (loaded ? module : '(' + module + ')') + suffix
    }
}

async function isModuleLoaded(mod: string) {
    if (!g_connection) {
        return false
    }
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
    let possibleModules: string[] = []
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

    const qp = vscode.window.createQuickPick()

    qp.canSelectMany = false
    qp.title = 'Select module'

    const setGlobally = {
        tooltip: 'Set globally',
        iconPath: new vscode.ThemeIcon('globe'),
    }

    qp.placeholder =
        'Select an item from the list to set it as the module for the current file or click the globe to use it for all files'

    qp.items = [
        {
            label: automaticallyChooseOption,
            buttons: [setGlobally],
        },
        {
            label: 'Main',
            buttons: [setGlobally],
        },
        {
            label: '',
            kind: vscode.QuickPickItemKind.Separator,
        },
        ...possibleModules.sort().map((mod: string) => {
            return {
                label: mod,
                buttons: [setGlobally],
            }
        }),
    ]

    qp.onDidTriggerItemButton((ev) => {
        if (ev.item.label === automaticallyChooseOption) {
            vscode.workspace.getConfiguration('julia.execution').update('module', undefined, true)
        } else {
            vscode.workspace.getConfiguration('julia.execution').update('module', ev.item.label, true)
        }
        qp.dispose()
    })

    qp.onDidAccept(() => {
        const selected = qp.selectedItems[0]

        if (!selected) {
            return
        }

        const ed = vscode.window.activeTextEditor

        if (selected.label === automaticallyChooseOption) {
            delete manuallySetDocuments[ed.document.fileName]
        } else {
            manuallySetDocuments[ed.document.fileName] = selected.label
        }

        cancelCurrentGetModuleRequest()
        g_currentGetModuleRequestCancelTokenSource = new vscode.CancellationTokenSource()
        updateStatusBarItem(ed, g_currentGetModuleRequestCancelTokenSource.token)

        qp.dispose()
    })

    qp.onDidHide(() => {
        qp.dispose()
    })

    qp.show()
}
