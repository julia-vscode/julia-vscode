import * as hljs from 'highlight.js'
import * as markdownit from 'markdown-it'
import * as path from 'path'
import * as vscode from 'vscode'
import { withLanguageClient } from '../extension'
import { constructCommandString, getVersionedParamsAtPosition } from '../utils'

function openArgs(href: string) {
    const matches = href.match(/^((?:\w+\:\/\/)?.+?)(?:\:(\d+))?$/)
    let uri
    let options
    if (matches[1]) {
        uri = vscode.Uri.parse(matches[1])
    }
    if (matches[2]) {
        const line = parseInt(matches[2])
        options = {
            selection: new vscode.Range(line, 0, line, 0)
        }
    }
    return { uri, options }
}

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
        const commandUri = constructCommandString('language-julia.findHelp', { searchTerm: tokens[idx + 1].content })
        tokens[idx].attrs[aIndex][1] = vscode.Uri.parse(commandUri).toString()
    } else if (aIndex >= 0 && tokens.length > idx + 1) {
        const href = tokens[idx + 1].content
        const { uri, options } = openArgs(href)
        // FIXME: opening at a position doesn't work
        const commandUri = constructCommandString('vscode.open', [uri, options])
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

export function activate(context: vscode.ExtensionContext) {
    const provider = new DocumentationViewProvider(context)

    context.subscriptions.push(
        vscode.commands.registerCommand('language-julia.show-documentation-pane', () => provider.showDocumentationPane()),
        vscode.commands.registerCommand('language-julia.show-documentation', () => provider.showDocumentation()),
        vscode.commands.registerCommand('language-julia.browse-back-documentation', () => provider.browseBack()),
        vscode.commands.registerCommand('language-julia.browse-forward-documentation', () => provider.browseForward()),
        vscode.commands.registerCommand('language-julia.findHelp', (mod) => provider.findHelp(mod)),
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
        view.webview.html = '<html>Who let the docs out?!</html>'
    }

    findHelp(mod: { searchTerm: string }) {
        console.log(`Searched for documentation topic '${mod.searchTerm}'.`)
    }

    async showDocumentationPane() {
        // this forces the webview to be resolved:
        await vscode.commands.executeCommand('julia-documentation.focus')
        // should always be true, but better safe than sorry
        if (this.view) {
            this.view.show?.(true)
        }
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
            },
            err => {
                console.log('making LC request failed')
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
        const documenterStylesheetcss = this.view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'documenter', 'documenter-dark.css')))
        const katexcss = this.view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'katex', 'katex.min.css')))

        const webfontjs = this.view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'webfont', 'webfont.js')))

        return `
    <html lang="en" class='theme--documenter-dark'>

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
