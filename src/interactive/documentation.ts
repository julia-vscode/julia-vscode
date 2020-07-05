import * as path from 'path'
import * as vscode from 'vscode'
import { withLanguageClient } from '../extension'
import { getVersionedParamsAtPosition, setContext } from '../utils'

const viewType = 'JuliaDocumentationBrowser'
const panelActiveContextKey = 'juliaDocumentationPaneActive'
let extensionPath: string | undefined = undefined
let panel: vscode.WebviewPanel = undefined
let messageSubscription: vscode.Disposable = undefined

const backStack = Array<string>() // also keep current page
let forwardStack = Array<string>()

export function activate(context: vscode.ExtensionContext) {
    // assets path
    extensionPath = context.extensionPath
    context.subscriptions.push(
        vscode.commands.registerCommand('language-julia.show-documentation-pane', showDocumentationPane),
        vscode.commands.registerCommand('language-julia.show-documentation', showDocumentation),
        vscode.commands.registerCommand('language-julia.browse-back-documentation', browseBack),
        vscode.commands.registerCommand('language-julia.browse-forward-documentation', browseForward),
    )
    setPanelContext()
    vscode.window.registerWebviewPanelSerializer(viewType, new DocumentationPaneSerializer())
}

function showDocumentationPane() {
    if (panel === undefined) {
        panel = createDocumentationPanel()
        setPanelSubscription()
    }
    if (panel !== undefined && !panel.visible) {
        panel.reveal()
    }
}

function createDocumentationPanel() {
    return vscode.window.createWebviewPanel(viewType, 'Julia Documentation Pane',
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
}

class DocumentationPaneSerializer implements vscode.WebviewPanelSerializer {
    async deserializeWebviewPanel(deserializedPanel: vscode.WebviewPanel, state: any) {
        panel = deserializedPanel
        setPanelSubscription()
        const { inner } = state
        const html = createWebviewHTML(inner)
        _setHTML(html)
    }
}

function setPanelSubscription() {
    panel.onDidChangeViewState(({ webviewPanel }) => {
        setPanelContext(webviewPanel.active)
    })
    panel.onDidDispose(() => {
        setPanelContext(false)
        if (messageSubscription !== undefined) {
            messageSubscription.dispose()
        }
        panel = undefined
    })
    setPanelContext(true)
}

function setPanelContext(state: boolean = false) {
    setContext(panelActiveContextKey, state)
}

const LS_ERR_MSG = `
Error: Julia Language server is not running.
Please wait a few seconds and try again once the \`Starting Julia Language Server...\` message in the status bar is gone.
`
async function showDocumentation() {
    // telemetry.traceEvent('command-showdocumentation')
    const inner = await getDocumentation()
    setDocumentation(inner)
}

async function getDocumentation(): Promise<string> {
    const editor = vscode.window.activeTextEditor
    const selection = editor.selection
    const position = new vscode.Position(selection.start.line, selection.start.character)

    return await withLanguageClient(
        async languageClient => {
            return languageClient.sendRequest('julia/getDocAt', getVersionedParamsAtPosition(editor, position))
        },
        err => {
            vscode.window.showErrorMessage(LS_ERR_MSG)
            return ''
        }
    )
}

function setDocumentation(inner: string) {
    if (!inner) { return }
    forwardStack = [] // initialize forward page stack for manual search
    showDocumentationPane()
    const html = createWebviewHTML(inner)
    _setHTML(html)
}

function createWebviewHTML(inner: string) {
    const darkMode = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark

    const googleFontscss = panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'google_fonts', 'css')))
    const fontawesomecss = panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'fontawesome', 'fontawesome.min.css')))
    const solidcss = panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'fontawesome', 'solid.min.css')))
    const brandscss = panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'fontawesome', 'brands.min.css')))
    const documenterStylesheetcss = panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'documenter', darkMode ? 'documenter-dark.css' : 'documenter-light.css')))
    const katexcss = panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'katex', 'katex.min.css')))

    const webfontjs = panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'webfont', 'webfont.js')))
    const katexjs = panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'katex', 'katex.min.js')))
    const katexautorenderjs = panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'katex', 'auto-render.min.js')))
    const highlightjs = panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'highlight', 'highlight.min.js')))
    const highlightjuliajs = panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'highlight', 'julia.min.js')))
    const highlightjuliarepljs = panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'highlight', 'julia-repl.min.js')))

    return `
<html lang="en" class=${darkMode ? 'theme--documenter-dark' : ''}>

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Julia Documentation Pane</title>
    <link href=${googleFontscss} rel="stylesheet" type="text/css" />
    <link href=${fontawesomecss} rel="stylesheet" type="text/css" />
    <link href=${solidcss} rel="stylesheet" type="text/css" />
    <link href=${brandscss} rel="stylesheet" type="text/css" />
    <link href=${katexcss} rel="stylesheet" type="text/css" />
    <link href=${documenterStylesheetcss} rel="stylesheet" type="text/css">

    <script src=${katexjs}></script>
    <script src=${katexautorenderjs}></script>
    <script src=${highlightjs}></script>
    <script src=${highlightjuliajs}></script>
    <script src=${highlightjuliarepljs}></script>

    <script type="text/javascript">
        // vscode API
        const vscode = acquireVsCodeApi()
        window.onload = () => {
            const els = document.getElementsByTagName('a')
            for (const el of els) {
                const href = el.getAttribute('href')
                if (href.includes('julia-vscode/')) {
                    const mod = href.split('/').pop()
                    el.onclick = () => {
                        vscode.postMessage({
                            method: 'search',
                            params: {
                                word: el.text,
                                mod
                            }
                        })
                    }
                }
            }
        }
        vscode.setState({ inner: \`${inner}\` })

        // styling
        hljs.initHighlightingOnLoad()
        WebFontConfig = {
            custom: {
                families: ['KaTeX_AMS', 'KaTeX_Caligraphic:n4,n7', 'KaTeX_Fraktur:n4,n7','KaTeX_Main:n4,n7,i4,i7', 'KaTeX_Math:i4,i7', 'KaTeX_Script','KaTeX_SansSerif:n4,n7,i4', 'KaTeX_Size1', 'KaTeX_Size2', 'KaTeX_Size3', 'KaTeX_Size4', 'KaTeX_Typewriter'],
                urls: ['${katexcss}']
            },
        }
        document.addEventListener(
            'DOMContentLoaded',
            () => {
                renderMathInElement(document.body, {
                    delimiters: [
                        { left: '$', right: '$', display: false },
                        { left: '$$', right: '$$', display: true },
                        { left: '\\[', right: '\\]', display: true }
                    ]
                })
            }
        )
    </script>

    <script src=${webfontjs}></script>

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

    // TODO: link handling for documentations retrieved from LS
    if (messageSubscription !== undefined) {
        messageSubscription.dispose() // dispose previouse
    }
    messageSubscription = panel.webview.onDidReceiveMessage(
        message => {
            if (message.method === 'search') {
                // withREPL(
                //     async connection => {
                //         const { word, mod } = message.params
                //         const inner = await connection.sendRequest(requestTypeGetDoc, { word, mod, })
                //         setDocumentation(inner)
                //     },
                //     err => { return '' }
                // )
            }
        }
    )

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
