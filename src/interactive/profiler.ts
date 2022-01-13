import * as path from 'path'
import * as vscode from 'vscode'
import { registerCommand } from '../utils'
import { openFile } from './results'

interface ProfilerFrame {
    meta: {
        func: string;
        file: string;
        path: string;
        line: number;
        count: number;
        flags: number;
    };
    children: ProfilerFrame[];
}

interface InlineTraceElement {
    path: string;
    line: number;
    fraction: number;
    count: number;
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

const profilerContextKey = 'jlProfilerFocus'
export class ProfilerFeature {
    context: vscode.ExtensionContext;
    panel: vscode.WebviewPanel;

    profiles: ProfilerFrame[] = [];
    inlineTrace: InlineTraceElement[] = [];
    decoration: vscode.TextEditorDecorationType;
    inlineMaxWidth: number = 100;
    currentProfileIndex: number = 0;

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

    setInlineTrace(profile: ProfilerFrame) {
        this.clearInlineTrace()

        this.decoration = vscode.window.createTextEditorDecorationType({
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            isWholeLine: true
        })

        const root = profile['all']
        this.buildInlineTraceElements(root, root.meta.count)

        this.refreshInlineTrace(vscode.window.visibleTextEditors)
    }

    buildInlineTraceElements(node: ProfilerFrame, parentCount: number) {
        this.inlineTrace.push({
            path: node.meta.path,
            line: node.meta.line,
            count: node.meta.count,
            fraction: node.meta.count / parentCount,
            flags: node.meta.flags
        })

        for (const child of node.children) {
            this.buildInlineTraceElements(child, node.meta.count)
        }
    }

    inlineTraceColor(highlight: InlineTraceElement | number) {
        const flags = (typeof highlight === 'number') ? highlight : highlight.flags
        if (flags & 0x01) {
            return 'rgba(204, 103, 103, 0.2)'
        }
        if (flags & 0x02) {
            return 'rgba(204, 153, 68, 0.2)'
        }
        return 'rgba(64, 99, 221, 0.2)'
    }

    collateTrace(editors: readonly vscode.TextEditor[]) {
        const edHighlights = {}
        for (const highlight of this.inlineTrace) {
            for (const editor of editors) {
                const uri = editor.document.uri.toString()
                if (
                    uri === vscode.Uri.file(highlight.path).toString()
                ) {
                    if (edHighlights[uri] === undefined) {
                        edHighlights[uri] = {}
                    }
                    const line = Math.max(0, highlight.line - 1)
                    const branchCount = (edHighlights[uri][line]?.branchCount ?? 0) + 1
                    const count = (edHighlights[uri][line]?.count ?? 0) + highlight.count
                    const fraction = ((edHighlights[uri][line]?.fraction ?? 0) * (branchCount - 1) + highlight.fraction)/branchCount
                    const flags = (edHighlights[uri][line]?.flags ?? 0) | highlight.flags

                    const hoverMessage = branchCount > 1 ?
                        `${count} samples (compound, ${branchCount} branches, on average ${(fraction * 100).toFixed()} % of parent) ${flagString(flags)}` :
                        `${count} samples (${(fraction * 100).toFixed()} % of parent) ${flagString(flags)}`
                    edHighlights[uri][line] = {
                        count,
                        fraction,
                        flags,
                        branchCount,
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
                                textDecoration: 'none; white-space: pre; position: absolute; pointer-events: none' // :grimacing:
                            }
                        }
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
                const highlights: {range: vscode.Range, hoverMessage: string, renderOptions}[] = Object.values(edHighlights[uri])
                editor.setDecorations(this.decoration, highlights)
            }
        }
    }

    createPanel() {
        if (this.panel) {
            return
        }
        this.panel = vscode.window.createWebviewPanel(
            'jlprofilerpane',
            this.makeTitle(),
            {
                preserveFocus: false,
                viewColumn: this.context.globalState.get(
                    'juliaProfilerViewColumn',
                    vscode.ViewColumn.Beside
                ),
            },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        )

        this.panel.webview.html = this.getContent()

        const messageHandler = this.panel.webview.onDidReceiveMessage(
            (message: { type: string; node: ProfilerFrame }) => {
                if (message.type === 'open') {
                    openFile(message.node.meta.path, message.node.meta.line)
                } else {
                    console.error('unknown message type received in profiler pane')
                }
            }
        )

        const viewStateListener = this.panel.onDidChangeViewState(
            ({ webviewPanel }) => {
                this.context.globalState.update(
                    'juliaProfilerViewColumn',
                    webviewPanel.viewColumn
                )
                vscode.commands.executeCommand(
                    'setContext',
                    profilerContextKey,
                    webviewPanel.active
                )
            }
        )

        this.panel.onDidDispose(() => {
            viewStateListener.dispose()
            messageHandler.dispose()
            vscode.commands.executeCommand('setContext', profilerContextKey, false)
            this.panel = undefined
            this.clearInlineTrace()
        })
    }

    show() {
        this.createPanel()
        this.panel.title = this.makeTitle()

        if (this.profileCount > 0) {
            const profile = this.profiles[this.currentProfileIndex]
            this.panel.webview.postMessage(profile)
            this.setInlineTrace(profile)
        }
        this.panel.reveal(this.panel.viewColumn, true)
    }

    showTrace(trace: ProfilerFrame) {
        this.profiles.push(trace)
        this.currentProfileIndex = this.profiles.length - 1
        this.show()
    }

    getContent() {
        const profilerURL = this.panel.webview.asWebviewUri(
            vscode.Uri.file(
                path.join(
                    this.context.extensionPath,
                    'scripts',
                    'profiler',
                    'profiler.js'
                )
            )
        )

        return `
        <html>
        <head>
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
            <script src="${profilerURL}"></script>
        </head>

        <body>
            <div id="profiler-container"></div>
            <script type="text/javascript">
                const vscode = acquireVsCodeApi();

                const container = document.getElementById("profiler-container");

                prof = new ProfileViewer(container);
                prof.registerCtrlClickHandler((node) => {
                    console.log(node);
                    vscode.postMessage({
                        type: "open",
                        node: node
                    });
                });

                window.addEventListener("message", (event) => {
                    console.log(event);
                    prof.setData(event.data);
                });
            </script>
        </body>
        </html>
        `
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
