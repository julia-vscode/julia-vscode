import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc'
import { onInit } from './repl'

let g_connection: rpc.MessageConnection = null
let g_panel: vscode.WebviewPanel = null

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('language-julia.show-documentation-pane', () => showDocumentationPane('')),
        vscode.commands.registerCommand('language-julia.show-documentation', showDocumentation),
        onInit(conn => {
            g_connection = conn
        })
    )
}

function showDocumentationPane(html: string) {
    if (!g_panel) {
        g_panel = vscode.window.createWebviewPanel('DocumentationPane', 'Julia Documentation Pane',
            {
                preserveFocus: true,
                viewColumn: vscode.ViewColumn.Beside,
            },
            {
                enableFindWidget: true,
            }
        )
    }
    if (!g_panel.visible) {
        g_panel.reveal()
    }
    g_panel.webview.html = html
}

async function showDocumentation() {
    // telemetry.traceEvent('command-showdocumentation')

    const editor = vscode.window.activeTextEditor
    const selection = editor.selection
    const positiion = new vscode.Position(selection.start.line, selection.start.character)
    // const module: string = await getModuleForEditor(editor, positiion)
    const range = editor.document.getWordRangeAtPosition(positiion)
    const word = editor.document.getText(range)

    const html = await g_connection.sendRequest(requestTypeGetDoc, word)
    showDocumentationPane(html)
}

const requestTypeGetDoc = new rpc.RequestType<string, string, void, void>('repl/getdoc')
