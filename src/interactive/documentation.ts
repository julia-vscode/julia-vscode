import * as path from 'path'
import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc'
import { getModuleForEditor } from './modules'
import { onInit } from './repl'

let g_connection: rpc.MessageConnection = null
let g_panel: vscode.WebviewPanel = null
let extensionPath: string

export function activate(context: vscode.ExtensionContext) {
    extensionPath = context.extensionPath
    context.subscriptions.push(
        vscode.commands.registerCommand('language-julia.show-documentation-pane', showDocumentationPane),
        vscode.commands.registerCommand('language-julia.show-documentation', showDocumentation),
        onInit(conn => {
            g_connection = conn
        })
    )
}

function showDocumentationPane() {
    if (!g_panel) {
        g_panel = vscode.window.createWebviewPanel('DocumentationPane', 'Julia Documentation Pane',
            {
                preserveFocus: true,
                viewColumn: vscode.ViewColumn.Beside,
            },
            {
                enableFindWidget: true,
                enableScripts: true,
            }
        )
    }
    if (!g_panel.visible) {
        g_panel.reveal()
    }
}

const requestTypeGetDoc = new rpc.RequestType<{ word: string, module: string }, string, void, void>('repl/getdoc')

async function showDocumentation() {
    // telemetry.traceEvent('command-showdocumentation')

    const editor = vscode.window.activeTextEditor
    const selection = editor.selection
    const positiion = new vscode.Position(selection.start.line, selection.start.character)
    const module: string = await getModuleForEditor(editor, positiion)
    const range = editor.document.getWordRangeAtPosition(positiion)
    const word = editor.document.getText(range)

    showDocumentationPane()
    setHTML(word, module)
}

async function setHTML(word: string, module: string) {
    const darkMode: boolean = vscode.workspace.getConfiguration('julia.documentation').darkMode

    const inner = await g_connection.sendRequest(requestTypeGetDoc, { word, module })

    const assetsDir = path.join(extensionPath, 'assets')
    const googleFonts = g_panel.webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, 'google_fonts')))
    const fontawesome = g_panel.webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, 'fontawesome.min.css')))
    const solid = g_panel.webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, 'solid.min.css')))
    const brands = g_panel.webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, 'brands.min.css')))
    const katex = g_panel.webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, 'katex.min.css')))
    const require = g_panel.webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, 'require.min.js')))
    const documenterScript = g_panel.webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, 'documenter.js')))
    const documenterStylesheet = g_panel.webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, darkMode ? 'documenter-dark.css' : 'documenter-light.css')))

    const html = `
<!DOCTYPE html>
<html lang="en" class=${darkMode ? 'theme--documenter-dark' : ''}>

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Julia Documentation Pane</title>
    <link href=${googleFonts} rel="stylesheet" type="text/css" />
    <link href=${fontawesome} rel="stylesheet" type="text/css" />
    <link href=${solid} rel="stylesheet" type="text/css" />
    <link href=${brands} rel="stylesheet" type="text/css" />
    <link href=${katex} rel="stylesheet" type="text/css" />
    <script>documenterBaseURL = ""</script>
    <script src=${require} data-main=${documenterScript}></script>
    <link href=${documenterStylesheet} rel="stylesheet" type="text/css">

    <script type="text/javascript">
        window.onload = () => {
            const vscode = acquireVsCodeApi()
            const els = document.getElementsByTagName('a')
            for (const el of els) {
                const href = el.getAttribute('href')
                if (href.includes('julia-vscode/')) {
                    const module = href.split('/').pop()
                    el.onclick = () => {
                        vscode.postMessage({
                            word: el.text,
                            module
                        })
                    }
                }
            }
        }
    </script>

</head>

<body>
    <div class="docs-main" style="padding: 1em">
        <article class="content">
            ${inner}
        </article>
    </div>
</body>

</html>
`

    g_panel.webview.html = html
    // link handling
    g_panel.webview.onDidReceiveMessage(message => {
        setHTML(message.word, message.module)
    })
}
