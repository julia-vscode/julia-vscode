import * as fs from 'async-file'
import * as path from 'path'
import { parse } from 'toml'
import * as vscode from 'vscode'
import { withLanguageClient } from '../extension'
import { registerCommand } from '../utils'


export function activate(context: vscode.ExtensionContext) {
    const provider = new PkgsViewProvider(context)

    context.subscriptions.push(
        registerCommand('language-julia.show-pkgs-pane', () => provider.showPkgsPane()),
        vscode.window.registerWebviewViewProvider('julia-pkgs', provider)
    )
}

type DepDetails = {
    path: string,
    type: 'Project' | 'Manifest',
}


class PkgsViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView
    private context: vscode.ExtensionContext
    private rootPath: string
    private tomlPath: string
    private tomlType: 'Project' | 'Manifest'

    constructor(context: vscode.ExtensionContext) {
        this.context = context
        const folders = vscode.workspace.workspaceFolders
        this.rootPath = folders[0].uri.fsPath
        const deps = this.resolveDepsPath()
        this.tomlPath = deps.path
        this.tomlType = deps.type

        this.loadDeps()
    }

    resolveDepsPath(): DepDetails {
        const ProjectTomlPath = path.join(this.rootPath, 'Project.toml')
        const ManifestTomlPath = path.join(this.rootPath, 'Manifest.toml')

        if (fs.exists(ProjectTomlPath)) {
            return {path: ProjectTomlPath, type: 'Project'}
        } else if (fs.exists(ManifestTomlPath)) {
            return {path: ManifestTomlPath, type: 'Manifest'}

        } else {
            return {path: null, type: null}
        }
    }

    loadDeps(): Promise<object> {
        return new Promise(resolve => {
            if (this.tomlPath !== null) {
                if (this.tomlType === 'Project') {
                    fs.readTextFile(this.tomlPath).then(t => {
                        const toml = parse(t)
                        const compat: object = toml.compat
                        resolve(compat)
                    })
                }
            }
        })
    }

    parseDeps(): Promise<string> {
        return new Promise(resolve => {
            this.loadDeps().then(deps => {
                const pkgsNames = Object.keys(deps)
                const htmlList = pkgsNames.map(name =>
                    `<li><h4>${name}</h4><span>${deps[name]}</span></li>`)
                    .join('')

                resolve(htmlList)
            })
        })

    }

    resolveWebviewView(view: vscode.WebviewView, context: vscode.WebviewViewResolveContext) {
        this.view = view


        view.webview.options = {
            enableScripts: true,
            enableCommandUris: true
        }
        this.parseDeps().then(depsList => {
            view.webview.html = this.createWebviewHTML(depsList)
        })

        view.webview.onDidReceiveMessage(msg => {
            if (msg.type === 'search') {
                this.showDocumentationFromWord(msg.query)
            } else {
                console.error('unknown message received')
            }
        })
    }

    async showPkgsPane() {
        // this forces the webview to be resolved:
        await vscode.commands.executeCommand('julia-pkgs.focus')
        // should always be true, but better safe than sorry
        if (this.view) {
            this.view.show?.(true)
        }
    }

    async showDocumentationFromWord(word: string) {
        const docAsMD = await this.getDocumentationFromWord(word)
        if (!docAsMD) { return }

        await this.showPkgsPane()
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


    createWebviewHTML(pkgsList: string) {
        console.log(pkgsList)
        // const docAsHTML = md.render(docAsMD)

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
        body:active {
            outline: 1px solid var(--vscode-focusBorder);
        }

       .pkgs-list > li {
            list-style-type: none;
            position: relative;
            margin-bottom: 4px;
        }

        span {
            margin-left: 5px;
        }

        li:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        ol, li, span, h4 {
            margin: 0;
        }

        h4 {
            position: relative;
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
        <p>Here we go!</p>
        <div class="docs-main" style="padding: 50px 1em 1em 1em">
                <ul class="pkgs-list">
                    ${pkgsList}
                </ul>
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
        if (this.view) {
            this.view.webview.html = html
        }
    }
}
