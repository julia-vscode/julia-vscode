import markdownit from 'markdown-it'
import * as path from 'path'
import * as vscode from 'vscode'
import { withLanguageClient } from '../extension'
import { constructCommandString, getVersionedParamsAtPosition, registerCommand } from '../utils'

function openArgs(href: string) {
    const matches = href.match(/^((\w+\:\/\/)?.+?)(?:[\:#](\d+))?$/)
    let uri
    let line
    if (matches[1] && matches[3] && matches[2] === undefined) {
        uri = matches[1]
        line = parseInt(matches[3])
    } else {
        uri = vscode.Uri.parse(matches[1])
    }
    return { uri, line }
}

const md = new markdownit().use(
    require('@traptitech/markdown-it-katex'),
    {
        output: 'html'
    }
).use(
    require('markdown-it-footnote')
)

// add custom validator to allow for file:// links
const BAD_PROTO_RE = /^(vbscript|javascript|data):/
const GOOD_DATA_RE = /^data:image\/(gif|png|jpeg|webp);/
md.validateLink = (url) => {
    // url should be normalized at this point, and existing entities are decoded
    const str = url.trim().toLowerCase()

    return BAD_PROTO_RE.test(str) ? (GOOD_DATA_RE.test(str) ? true : false) : true
}

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const aIndex = tokens[idx].attrIndex('href')

    if (aIndex >= 0 && tokens[idx].attrs[aIndex][1] === '@ref' && tokens.length > idx + 1) {
        const commandUri = constructCommandString('language-julia.search-word', { searchTerm: tokens[idx + 1].content })
        tokens[idx].attrs[aIndex][1] = vscode.Uri.parse(commandUri).toString()
    } else if (aIndex >= 0 && tokens.length > idx + 1) {
        const href = tokens[idx + 1].content
        const { uri, line } = openArgs(href)
        let commandUri
        if (line === undefined) {
            commandUri = constructCommandString('vscode.open', uri)
        } else {
            commandUri = constructCommandString('language-julia.openFile', { path: uri, line })
        }
        tokens[idx].attrs[aIndex][1] = commandUri
    }

    return self.renderToken(tokens, idx, options)
}

export function activate(context: vscode.ExtensionContext) {
    const provider = new DocumentationViewProvider(context)

    context.subscriptions.push(
        registerCommand('language-julia.show-documentation-pane', () => provider.showDocumentationPane()),
        registerCommand('language-julia.show-documentation', () => provider.showDocumentation()),
        registerCommand('language-julia.browse-back-documentation', () => provider.browseBack()),
        registerCommand('language-julia.browse-forward-documentation', () => provider.browseForward()),
        registerCommand('language-julia.search-word', (params) => provider.findHelp(params)),
        vscode.window.registerWebviewViewProvider('julia-documentation', provider)
    )
}

class DocumentationViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView
    private context: vscode.ExtensionContext

    private backStack = Array<string>() // also keep current page
    private forwardStack = Array<string>()

    constructor(context) {
        this.context = context
    }

    resolveWebviewView(view: vscode.WebviewView, context: vscode.WebviewViewResolveContext) {
        this.view = view

        view.webview.options = {
            enableScripts: true,
            enableCommandUris: true
        }
        view.webview.html = this.createWebviewHTML('Use the `language-julia.show-documentation` command in an editor or search for documentation above.')

        view.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'search') {
                this.showDocumentationFromWord(msg.query)
            } else {
                console.error('unknown message received')
            }
        })
    }

    findHelp(params: { searchTerm: string }) {
        this.showDocumentationFromWord(params.searchTerm)
    }

    async showDocumentationPane() {
        if (this.view?.show === undefined) {
            // this forces the webview to be resolved, but changes focus:
            await vscode.commands.executeCommand('julia-documentation.focus')
        }
        this.view.show(true)
    }

    async showDocumentationFromWord(word: string) {
        const docAsMD = await this.getDocumentationFromWord(word)
        if (!docAsMD) { return }

        await this.showDocumentationPane()
        const html = this.createWebviewHTML(docAsMD)
        this.setHTML(html)
    }

    async getDocumentationFromWord(word: string): Promise<string> {
        return await withLanguageClient(
            async languageClient => {
                return await languageClient.sendRequest('julia/getDocFromWord', { word: word })
            }, err => {
                console.error('LC request failed with ', err)
                return ''
            }
        )
    }

    async showDocumentation() {
        // telemetry.traceEvent('command-showdocumentation')
        const editor = vscode.window.activeTextEditor
        if (!editor) { return }

        const docAsMD = await this.getDocumentation(editor)
        if (!docAsMD) { return }

        this.forwardStack = [] // initialize forward page stack for manual search
        await this.showDocumentationPane()
        const html = this.createWebviewHTML(docAsMD)
        this.setHTML(html)
    }

    async getDocumentation(editor: vscode.TextEditor): Promise<string> {
        return await withLanguageClient(
            async languageClient => {
                return await languageClient.sendRequest<string>('julia/getDocAt', getVersionedParamsAtPosition(editor.document, editor.selection.start))
            }, err => {
                console.error('LC request failed with ', err)
                return ''
            }
        )
    }

    createWebviewHTML(docAsMD: string) {
        const docAsHTML = md.render(docAsMD)

        const extensionPath = this.context.extensionPath

        const googleFontscss = this.view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'google_fonts', 'css')))
        const fontawesomecss = this.view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'fontawesome', 'fontawesome.min.css')))
        const solidcss = this.view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'fontawesome', 'solid.min.css')))
        const brandscss = this.view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'fontawesome', 'brands.min.css')))
        const documenterStylesheetcss = this.view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'documenter', 'documenter-vscode.css')))
        const katexcss = this.view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'katex', 'katex.min.css')))

        const webfontjs = this.view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'webfont', 'webfont.js')))

        return `
    <html lang="en" class='theme--documenter-vscode'>

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

        <style>
        body {
            word-break: normal;
            overflow-wrap: break-word;
        }
        body:active {
            outline: 1px solid var(--vscode-focusBorder);
        }
        .search {
            position: fixed;
            background-color: var(--vscode-sideBar-background);
            width: 100%;
            padding: 5px;
            display: flex;
            z-index: 2;
        }
        .search input[type="text"] {
            width: 100%;
            background-color: var(--vscode-input-background);
            border: none;
            outline: none;
            color: var(--vscode-input-foreground);
            padding: 4px;
        }
        .search input[type="text"]:focus {
            outline: 1px solid var(--vscode-editorWidget-border);
        }
        button {
            width: 30px;
            margin: 0 5px 0 0;
            display: inline;
            border: none;
            box-sizing: border-box;
            padding: 5px 7px;
            text-align: center;
            cursor: pointer;
            justify-content: center;
            align-items: center;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-family: var(--vscode-font-family);
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        button:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: 0px;
        }
        </style>

        <script src=${webfontjs}></script>
    </head>

    <body>
        <div class="search">
            <input id="search-input" type="text" placeholder="Search"></input>
        </div>
        <div class="docs-main" style="padding: 50px 1em 1em 1em">
            <article class="content">
                ${docAsHTML}
            </article>
        </div>
        <script>
            const vscode = acquireVsCodeApi()

            function search(val) {
                if (val) {
                    vscode.postMessage({
                        type: 'search',
                        query: val
                    })
                }
            }
            function onKeyDown(ev) {
                if (ev && ev.keyCode === 13) {
                    const val = document.getElementById('search-input').value
                    search(val)
                }
            }
            document.getElementById('search-input').addEventListener('keydown', onKeyDown)
        </script>
    </body>

    </html>
    `
    }

    setHTML(html: string) {
        // set current stack
        this.backStack.push(html)

        if (this.view) {
            this.view.webview.html = html
        }
    }

    isBrowseBackAvailable() {
        return this.backStack.length > 1
    }

    isBrowseForwardAvailable() {
        return this.forwardStack.length > 0
    }

    browseBack() {
        if (!this.isBrowseBackAvailable()) { return }

        const current = this.backStack.pop()
        this.forwardStack.push(current)

        this.setHTML(this.backStack.pop())
    }

    browseForward() {
        if (!this.isBrowseForwardAvailable()) { return }

        this.setHTML(this.forwardStack.pop())
    }
}
