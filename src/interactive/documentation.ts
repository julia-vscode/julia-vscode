import * as path from 'path'
import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc'
import { setContext } from '../utils'
import { getModuleForEditor } from './modules'
import { onInit } from './repl'

const viewType = 'JuliaDocumentationBrowser'
const panelActiveContextKey = 'juliaDocumentationPaneActive'
let connection: rpc.MessageConnection = null
let extensionPath: string = null
let panel: vscode.WebviewPanel = null
let messageSubscription: vscode.Disposable = null

const backStack: string[] = [] // also keep current page
let forwardStack: string[] = []

export function activate(context: vscode.ExtensionContext) {
    // assets path
    extensionPath = context.extensionPath
    context.subscriptions.push(
        vscode.commands.registerCommand('language-julia.show-documentation-pane', showDocumentationPane),
        vscode.commands.registerCommand('language-julia.show-documentation', showDocumentation),
        vscode.commands.registerCommand('language-julia.browse-back-documentation', browseBack),
        vscode.commands.registerCommand('language-julia.browse-forward-documentation', browseForward),
        onInit(conn => {
            connection = conn
        })
    )
    setPanelContext()
    vscode.window.registerWebviewPanelSerializer(viewType, new DocumentationPaneSerializer())
}

function showDocumentationPane() {
    if (!panel) {
        createDocumentationPanel()
    }
    if (!panel.visible) {
        panel.reveal()
    }
}

function createDocumentationPanel() {
    panel = vscode.window.createWebviewPanel(viewType, 'Julia Documentation Pane',
        {
            preserveFocus: true,
            viewColumn: vscode.ViewColumn.Beside,
        },
        {
            enableFindWidget: true,
            // retainContextWhenHidden: true, // comment in if loading is slow, while there would be high memory overhead
            enableScripts: true,
        }
    )
    setPanelSubscription(panel)
}

class DocumentationPaneSerializer implements vscode.WebviewPanelSerializer {
    async deserializeWebviewPanel(deserializedPanel: vscode.WebviewPanel, state: any) {
        panel = deserializedPanel
        const { inner } = state
        const html = createWebviewHTML(inner)
        _setHTML(html)
        setPanelSubscription(panel)
    }
}

function setPanelSubscription(panel: vscode.WebviewPanel) {
    panel.onDidChangeViewState(({ webviewPanel }) => {
        setPanelContext(webviewPanel.active)
    })
    panel.onDidDispose(() => {
        setPanelContext(false)
        if (messageSubscription) {
            messageSubscription.dispose()
        }
        panel = null
    })
    setPanelContext(true)
}

function setPanelContext(state: boolean = false) {
    setContext(panelActiveContextKey, state)
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
    forwardStack = [] // initialize forward page stack for manual search
    setHTML(word, module)
}

async function setHTML(word: string, module: string) {
    const inner = await connection.sendRequest(requestTypeGetDoc, { word, module })
    const html = createWebviewHTML(inner)
    _setHTML(html)
}

function createWebviewHTML(inner: string) {
    const darkMode: boolean = vscode.workspace.getConfiguration('julia.documentation').darkMode

    const assetsDir = path.join(extensionPath, 'assets')
    const googleFonts = panel.webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, 'google_fonts')))
    const fontawesome = panel.webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, 'fontawesome.min.css')))
    const solid = panel.webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, 'solid.min.css')))
    const brands = panel.webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, 'brands.min.css')))
    const katex = panel.webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, 'katex.min.css')))
    const require = panel.webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, 'require.min.js')))
    const documenterScript = panel.webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, 'documenter.js')))
    const documenterStylesheet = panel.webview.asWebviewUri(vscode.Uri.file(path.join(assetsDir, darkMode ? 'documenter-dark.css' : 'documenter-light.css')))

    return `
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
        const vscode = acquireVsCodeApi()
        window.onload = () => {
            const els = document.getElementsByTagName('a')
            for (const el of els) {
                const href = el.getAttribute('href')
                if (href.includes('julia-vscode/')) {
                    const module = href.split('/').pop()
                    el.onclick = () => {
                        vscode.postMessage({
                            method: 'search',
                            params: {
                                word: el.text,
                                module
                            }
                        })
                    }
                }
            }
        }
        vscode.setState({ inner: \`${inner}\` })
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
}

function _setHTML(html: string) {
    // set current stack
    backStack.push(html)

    // link handling
    if (messageSubscription) {
        messageSubscription.dispose() // dispose previouse
    }
    messageSubscription = panel.webview.onDidReceiveMessage(
        message => {
            if (message.method === 'search') {
                const { word, module } = message.params
                setHTML(word, module)
            }
        }
    )

    // set content
    panel.webview.html = html
}

function isBrowseBackAvailable() {
    return backStack.length > 1
}

function isBrowseForwardAvailable() {
    return forwardStack.length > 0
}

function browseBack() {
    if (!isBrowseBackAvailable()) { return }

    const current = backStack.pop()
    forwardStack.push(current)

    _setHTML(backStack.pop())
}

function browseForward() {
    if (!isBrowseForwardAvailable()) { return }

    _setHTML(forwardStack.pop())
}
