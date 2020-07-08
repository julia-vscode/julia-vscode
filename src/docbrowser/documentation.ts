import * as hljs from 'highlight.js'
import * as markdownit from 'markdown-it'
import * as path from 'path'
import * as vscode from 'vscode'
import { withLanguageClient } from '../extension'
import { constructCommandString, getVersionedParamsAtPosition, setContext } from '../utils'

const md = new markdownit(
    {
        highlight: (str: string, lang: string) => {
            if (lang) {
                if (hljs.getLanguage(lang)) {
                    try {
                        return hljs.highlight(lang, str).value
                    } catch (__) { }
                }
                else if (lang === 'juliarepl' || lang === 'jldoctest' || lang === 'jldoctest;') {
                    return hljs.highlight('julia-repl', str).value
                }
            }
            return ''
        }
    }).
    use(
        require('@traptitech/markdown-it-katex'),
        {
            output: 'html'
        }
    ).
    use(
        require('markdown-it-footnote')
    )

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const aIndex = tokens[idx].attrIndex('href')

    if (aIndex >= 0 && tokens[idx].attrs[aIndex][1] === '@ref' && tokens.length > idx + 1) {
        const commandUri = constructCommandString('language-julia', { searchTerm: tokens[idx + 1].content })
        tokens[idx].attrs[aIndex][1] = commandUri
    }

    return self.renderToken(tokens, idx, options)
}

// highlight inline code with Julia syntax
md.renderer.rules.code_inline = (tokens, idx, options) => {
    const code = tokens[idx]
    const highlighted = options.highlight(code.content, 'julia')
    return `<code class="language-julia">${highlighted}</code>`
}

let g_context: vscode.ExtensionContext | undefined = undefined
const g_panelActiveContextKey = 'juliaDocumentationPaneActive'
let g_panel: vscode.WebviewPanel | undefined = undefined

const g_backStack = Array<string>() // also keep current page
let g_forwardStack = Array<string>()

export function activate(context: vscode.ExtensionContext) {
    g_context = context

    context.subscriptions.push(
        vscode.commands.registerCommand('language-julia.show-documentation-pane', showDocumentationPane),
        vscode.commands.registerCommand('language-julia.show-documentation', showDocumentation),
        vscode.commands.registerCommand('language-julia.browse-back-documentation', browseBack),
        vscode.commands.registerCommand('language-julia.browse-forward-documentation', browseForward),
        vscode.commands.registerCommand('language-julia.findHelp', findHelp)
    )
    setPanelContext(false)
}

function findHelp(mod: { searchTerm: string }) {
    console.log(`Searched for documentation topic '${mod.searchTerm}'.`)
}

function showDocumentationPane() {
    if (g_panel === undefined) {
        g_panel = vscode.window.createWebviewPanel('JuliaDocumentationBrowser', 'Julia Documentation Pane',
            {
                preserveFocus: true,
                viewColumn: g_context.globalState.get('juliaDocumentationPanelViewColumn', vscode.ViewColumn.Beside),
            },
            {
                enableFindWidget: true,
                // retainContextWhenHidden: true, // comment in if loading is slow, while there would be high memory overhead
                enableScripts: true,
            }
        )

        g_panel.onDidChangeViewState(({ webviewPanel }) => {
            g_context.globalState.update('juliaDocumentationPanelViewColumn', webviewPanel.viewColumn)
            setPanelContext(webviewPanel.active)
        })

        g_panel.onDidDispose(() => {
            setPanelContext(false)
            g_panel = undefined
        })

        setPanelContext(true)
    }
    else if (!g_panel.visible) {
        g_panel.reveal()
    }
}

function setPanelContext(state: boolean) {
    setContext(g_panelActiveContextKey, state)
}

const LS_ERR_MSG = `
Error: Julia Language server is not running.
Please wait a few seconds and try again once the \`Starting Julia Language Server...\` message in the status bar is gone.
`
async function showDocumentation() {
    // telemetry.traceEvent('command-showdocumentation')
    const editor = vscode.window.activeTextEditor
    if (!editor) { return }

    const docAsMD = await getDocumentation(editor)
    if (!docAsMD) { return }

    g_forwardStack = [] // initialize forward page stack for manual search
    showDocumentationPane()
    const html = createWebviewHTML(docAsMD)
    _setHTML(html)
}

async function getDocumentation(editor: vscode.TextEditor): Promise<string> {
    return await withLanguageClient(
        async languageClient => {
            return await languageClient.sendRequest<string>('julia/getDocAt', getVersionedParamsAtPosition(editor, editor.selection.start))
        },
        err => {
            vscode.window.showErrorMessage(LS_ERR_MSG)
            return ''
        }
    )
}

function createWebviewHTML(docAsMD: string) {
    const docAsHTML = md.render(docAsMD)
    const darkMode = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark

    const extensionPath = g_context.extensionPath

    const googleFontscss = g_panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'google_fonts', 'css')))
    const fontawesomecss = g_panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'fontawesome', 'fontawesome.min.css')))
    const solidcss = g_panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'fontawesome', 'solid.min.css')))
    const brandscss = g_panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'fontawesome', 'brands.min.css')))
    const documenterStylesheetcss = g_panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'documenter', darkMode ? 'documenter-dark.css' : 'documenter-light.css')))
    const katexcss = g_panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'katex', 'katex.min.css')))

    const webfontjs = g_panel.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'webfont', 'webfont.js')))

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

    <script type="text/javascript">
        WebFontConfig = {
            custom: {
                families: ['KaTeX_AMS', 'KaTeX_Caligraphic:n4,n7', 'KaTeX_Fraktur:n4,n7','KaTeX_Main:n4,n7,i4,i7', 'KaTeX_Math:i4,i7', 'KaTeX_Script','KaTeX_SansSerif:n4,n7,i4', 'KaTeX_Size1', 'KaTeX_Size2', 'KaTeX_Size3', 'KaTeX_Size4', 'KaTeX_Typewriter'],
                urls: ['${katexcss}']
            },
        }
    </script>

    <script src=${webfontjs}></script>
</head>

<body>
    <div class="docs-main" style="padding: 1em">
        <article class="content">
            ${docAsHTML}
        </article>
    </div>
</body>

</html>
`
}

function _setHTML(html: string) {
    // set current stack
    g_backStack.push(html)

    g_panel.webview.html = html
}

function isBrowseBackAvailable() {
    return g_backStack.length > 1
}

function isBrowseForwardAvailable() {
    return g_forwardStack.length > 0
}

function browseBack() {
    if (!isBrowseBackAvailable()) { return }

    const current = g_backStack.pop()
    g_forwardStack.push(current)

    _setHTML(g_backStack.pop())
}

function browseForward() {
    if (!isBrowseForwardAvailable()) { return }

    _setHTML(g_forwardStack.pop())
}
