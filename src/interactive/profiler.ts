import * as path from 'path'
import * as vscode from 'vscode'
import { readFile, writeFile } from 'fs/promises'
import { registerCommand, setContext } from '../utils'
import { openFile } from './results'

interface ProfilerFrame {
    func: string;
    file: string;
    path: string;
    line: number;
    count: number;
    countLabel?: number | string
    flags: number;
    children: ProfilerFrame[];
}

interface ProfileRoot {
    data: Record<string, ProfilerFrame>
    type: string
}

interface InlineTraceElement {
    path: string;
    line: number;
    fraction: number;
    count: number;
    countLabel?: number | string
    flags: number;
}

function flagString(flags: number) {
    let out = ''
    if (flags & 0x01) {
        out += 'GC'
    }
    if (flags & 0x02) {
        out += ' dispatch'
    }
    if (flags & 0x08) {
        out += ' compilation'
    }
    if (flags & 0x10) {
        out += ' task'
    }
    if (out !== '') {
        out = '\n\n Flags: ' + out
    }
    return out
}

const profilerContextKey = 'julia.profilerFocus'
export class ProfilerFeature {
    context: vscode.ExtensionContext
    panel: vscode.WebviewPanel

    profiles: ProfileRoot[] = []
    inlineTrace: InlineTraceElement[] = []
    decoration: vscode.TextEditorDecorationType
    inlineMaxWidth: number = 100
    currentProfileIndex: number = 0
    selection: string = 'all'

    constructor(context: vscode.ExtensionContext) {
        this.context = context

        this.context.subscriptions.push(
            registerCommand('language-julia.openProfiler', () => {
                this.show()
            }),
            registerCommand('language-julia.nextProfile', () => {
                this.next()
            }),
            registerCommand('language-julia.previousProfile', () => {
                this.previous()
            }),
            registerCommand('language-julia.deleteProfile', () => {
                this.delete()
            }),
            registerCommand('language-julia.deleteAllProfiles', () => {
                this.deleteAll()
            }),
            registerCommand('language-julia.saveProfileToFile', () => {
                this.saveToFile()
            }),
            vscode.window.onDidChangeVisibleTextEditors((editors) =>
                this.refreshInlineTrace(editors)
            )
        )
    }

    clearInlineTrace() {
        this.inlineTrace = []
        if (this.decoration) {
            this.decoration.dispose()
        }
        this.decoration = undefined
    }

    setInlineTrace(profile: Record<string, ProfilerFrame>) {
        this.clearInlineTrace()

        this.decoration = vscode.window.createTextEditorDecorationType({
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            isWholeLine: true,
        })

        const root = profile[this.selection]
        this.buildInlineTraceElements(root, root.count)

        this.refreshInlineTrace(vscode.window.visibleTextEditors)
    }

    buildInlineTraceElements(node: ProfilerFrame, rootCount: number) {
        this.inlineTrace.push({
            path: node.path,
            line: node.line,
            count: node.count,
            countLabel: node.countLabel,
            fraction: node.count / rootCount,
            flags: node.flags,
        })

        for (const child of node.children) {
            this.buildInlineTraceElements(child, rootCount)
        }
    }

    inlineTraceColor(highlight: InlineTraceElement | number) {
        const flags = typeof highlight === 'number' ? highlight : highlight.flags
        if (flags & 0x01) {
            return new vscode.ThemeColor('julia.profiler.dispatch')
        }
        if (flags & 0x02) {
            return new vscode.ThemeColor('julia.profiler.gc')
        }
        return new vscode.ThemeColor('julia.profiler.default')
    }

    collateTrace(editors: readonly vscode.TextEditor[]) {
        const edHighlights = {}
        for (const highlight of this.inlineTrace) {
            for (const editor of editors) {
                const uri = editor.document.uri.toString()
                if (uri === vscode.Uri.file(highlight.path).toString()) {
                    if (edHighlights[uri] === undefined) {
                        edHighlights[uri] = {}
                    }
                    const line = Math.max(0, highlight.line - 1)
                    const count = (edHighlights[uri][line]?.count ?? 0) + highlight.count
                    const fraction = (edHighlights[uri][line]?.fraction ?? 0) + highlight.fraction
                    const flags = (edHighlights[uri][line]?.flags ?? 0) | highlight.flags

                    const hoverMessage = (highlight.countLabel || `${count} samples`).toString() + ` (${(fraction * 100).toFixed()}%) ${flagString(flags)}`
                    edHighlights[uri][line] = {
                        count,
                        fraction,
                        flags,
                        range: new vscode.Range(
                            new vscode.Position(line, 0),
                            new vscode.Position(line, 0)
                        ),
                        hoverMessage,
                        renderOptions: {
                            before: {
                                contentText: ' ',
                                backgroundColor: this.inlineTraceColor(flags),
                                width: fraction * 20 + 'em',
                                textDecoration:
                                                'none; white-space: pre; position: absolute; pointer-events: none', // :grimacing:
                            },
                        },
                    }
                }
            }
        }

        return edHighlights
    }

    refreshInlineTrace(editors: readonly vscode.TextEditor[]) {
        if (editors.length === 0) {
            return
        }
        const edHighlights = this.collateTrace(editors)

        for (const editor of editors) {
            const uri = editor.document.uri.toString()
            if (edHighlights[uri]) {
                const highlights: {
                                    range: vscode.Range;
                                    hoverMessage: string;
                                    renderOptions;
                                }[] = Object.values(edHighlights[uri])
                editor.setDecorations(this.decoration, highlights)
            }
        }
    }

    async createPanel() {
        if (this.panel) {
            return
        }
        this.panel = vscode.window.createWebviewPanel(
            'jlprofilerpane',
            this.makeTitle(),
            {
                preserveFocus: true,
                viewColumn: this.context.globalState.get(
                    'juliaProfilerViewColumn',
                    vscode.ViewColumn.Two
                ),
            },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        )

        let isProfilerPaneReady

        const loadedPromise = new Promise((resolve) => {
            isProfilerPaneReady = resolve
        })

        const messageHandler = this.panel.webview.onDidReceiveMessage(
            (message: { type: string; node?: ProfilerFrame; selection?: string }) => {
                if (message.type === 'open') {
                    openFile(
                        message.node.path,
                        message.node.line,
                        this.panel.viewColumn === vscode.ViewColumn.Two
                            ? vscode.ViewColumn.One
                            : vscode.ViewColumn.Beside
                    )
                } else if (message.type === 'selectionChange') {
                    this.selection = message.selection
                    this.setInlineTrace(this.profiles[this.currentProfileIndex].data)
                } else if (message.type === 'profilerLoaded') {
                    isProfilerPaneReady?.()
                } else {
                    console.error('unknown message type received in profiler pane')
                }
            }
        )

        this.panel.webview.html = this.getContent()

        await loadedPromise

        const viewStateListener = this.panel.onDidChangeViewState(
            ({ webviewPanel }) => {
                this.context.globalState.update(
                    'juliaProfilerViewColumn',
                    webviewPanel.viewColumn
                )
                setContext(profilerContextKey, webviewPanel.active)
            }
        )

        this.panel.onDidDispose(() => {
            viewStateListener.dispose()
            messageHandler.dispose()
            setContext(profilerContextKey, false)
            this.panel = undefined
            this.clearInlineTrace()
        })
    }

    async show() {
        this.selection = 'all'
        await this.createPanel()
        this.panel.title = this.makeTitle()

        if (this.profileCount > 0) {
            const profile = this.profiles[this.currentProfileIndex]
            this.panel.webview.postMessage(profile)
            this.selection = Object.keys(profile.data)[0]
            this.setInlineTrace(profile.data)
        } else {
            this.panel.webview.postMessage(null)
            this.clearInlineTrace()
        }
        if (!this.panel.visible) {
            this.panel.reveal(this.panel.viewColumn, true)
        }
    }

    showTrace(trace: ProfileRoot) {
        this.profiles.push(trace)
        this.currentProfileIndex = this.profiles.length - 1
        this.show()
    }

    profileViewerJSPath() {
        return path.join(
            this.context.extensionPath,
            'libs',
            'jl-profile',
            'dist',
            'profile-viewer.js'
        )
    }

    getContent() {
        const profilerURL = this.panel.webview.asWebviewUri(
            vscode.Uri.file(this.profileViewerJSPath())
        )

        return `
        <!DOCTYPE html>
        <html lang="en">
            <style>
            body {
                width: 100vw;
                height: 100vh;
                padding: 0;
                margin: 0;
            }

            #profiler-container {
                padding: 0;
                margin: 0;
                position: absolute;
                top: 0;
                left: 0;
                bottom: 0;
                right: 0;
                overflow: hidden;
            }

            select {
                color: var(--vscode-input-foreground);
                background: var(--vscode-input-background);
                border: 1px solid var(--vscode-searchEditor-textInputBorder);
                border-radius: 0;
                font-size: inherit;
                padding: 0.125rem 0.5rem;
                height: calc(1.5em + 0.25rem + 2px);
                margin-left: 0.5rem;
            }

            button {
                display: inline;
                text-decoration: none;
                border: none;
                box-sizing: border-box;
                text-align: center;
                cursor: pointer;
                justify-content: center;
                align-items: center;
                color: var(--vscode-textLink-foreground);
                background: none;
                font-family: var(--vscode-font-family);
                font-size: 1em;
            }

            #profiler-container .__profiler-filter {
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            #profiler-container .__profiler-tooltip {
                background-color: var(--vscode-editorHoverWidget-background);
                border: 1px solid var(--vscode-editorHoverWidget-border);
                font-size: 1em !important;
            }
            </style>
        </head>

        <body>
            <div id="profiler-container"></div>
            <script type="text/javascript">
                const vscode = acquireVsCodeApi();

                const container = document.getElementById("profiler-container");

                import('${profilerURL}').then(({ProfileViewer}) => {
                    prof = new ProfileViewer(container);
                    prof.registerCtrlClickHandler((node) => {
                        vscode.postMessage({
                            type: "open",
                            node: node
                        });
                    });
                    prof.registerSelectionHandler((selection) => {
                        vscode.postMessage({
                            type: "selectionChange",
                            selection: selection
                        });
                    });

                    window.addEventListener("message", (event) => {
                        if (event.data) {
                            prof.setData(event.data.data);
                            prof.setSelectorLabel(event.data.type);
                        } else {
                            prof.setData(null)
                        }
                    });
                    vscode.postMessage({
                        type: "profilerLoaded",
                    });
                });
            </script>
        </body>
        </html>
        `
    }

    async saveToFile() {
        if (this.profiles.length === 0 || !this.profiles[this.currentProfileIndex]) {
            vscode.window.showErrorMessage('Not Profile trace recorded.')
            return
        }
        let defaultUri = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0]?.uri : undefined
        if (defaultUri) {
            defaultUri = defaultUri.with({
                path: defaultUri.path + '/profile.html'
            })
        }
        const savePath = await vscode.window.showSaveDialog({
            title: 'Save Profile Trace',
            filters: {
                'HTML': ['html']
            },
            defaultUri
        })
        if (!savePath) {
            return
        }
        const jsProfileScript = await readFile(this.profileViewerJSPath())
        const jsProfileDataUrl = 'data:text/javascript;base64,' + btoa(jsProfileScript.toString())
        writeFile(savePath.fsPath, `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <title>Profile Trace</title>
            <style>
            #profiler-container {
                margin: 0;
                padding: 0;
                width: 100vw;
                height: 100vh;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
            }
            body {
                margin: 0;
                padding: 0;
                width: 100vw;
                height: 100vh;
                overflow: hidden;
            }
            </style>
        </head>

        <body>
            <div id="profiler-container"></div>
            <script type="text/javascript">
                const container = document.getElementById("profiler-container");
                import('${jsProfileDataUrl}').then(({ProfileViewer}) => {
                    prof = new ProfileViewer(container);
                    prof.setData(${JSON.stringify(this.profiles[this.currentProfileIndex].data)});
                    prof.setSelectorLabel(${JSON.stringify(this.profiles[this.currentProfileIndex].type)});
                });
            </script>
        </body>
        </html>
        `)
    }

    previous() {
        if (this.currentProfileIndex > 0) {
            this.currentProfileIndex -= 1
            this.show()
        }
    }

    next() {
        if (this.currentProfileIndex < this.profiles.length - 1) {
            this.currentProfileIndex += 1
            this.show()
        }
    }

    delete() {
        this.profiles.splice(this.currentProfileIndex, 1)
        this.currentProfileIndex = Math.min(
            this.currentProfileIndex + 1,
            this.profiles.length - 1
        )
        this.show()
    }

    deleteAll() {
        this.profiles = []
        this.currentProfileIndex = 0
        this.show()
    }

    get profileCount() {
        return this.profiles.length
    }

    makeTitle() {
        return `Profiler (${this.currentProfileIndex + 1}/${this.profileCount})`
    }

    dispose() {
        if (this.panel) {
            this.panel.dispose()
        }
    }
}
