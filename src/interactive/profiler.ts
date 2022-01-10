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

const profilerContextKey = 'jlProfilerFocus'
export class ProfilerFeature {
    context: vscode.ExtensionContext;
    panel: vscode.WebviewPanel;

    profiles: ProfilerFrame[] = []
    currentProfileIndex: number = 0

    constructor(context: vscode.ExtensionContext) {
        this.context = context

        this.context.subscriptions.push(
            registerCommand('language-julia.openProfiler', () => {
                this.showPanel()
            })
        )
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
            }
        )

        this.panel.webview.html = this.getContent()

        const messageHandler = this.panel.webview.onDidReceiveMessage((message: {type: string, node: ProfilerFrame}) => {
            if (message.type === 'open') {
                openFile(message.node.meta.path, message.node.meta.line)
            } else {
                console.error('unknown message type received in profiler pane')
            }
        })

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
        })
    }

    showPanel() {
        this.createPanel()
        this.panel.title = this.makeTitle()

        if (this.profileCount > 0) {
            this.panel.webview.postMessage(
                this.profiles[this.currentProfileIndex]
            )
        }
        this.panel.reveal(this.panel.viewColumn, true)
    }

    showTrace(trace: ProfilerFrame) {
        this.profiles.push(trace)
        this.currentProfileIndex = this.profiles.length - 1
        this.showPanel()
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
    `
    }

    previous() {
        if (this.currentProfileIndex > 0) {
            this.currentProfileIndex -= 1
            this.showPanel()
        }
    }

    next() {
        if (this.currentProfileIndex < this.profiles.length - 1) {
            this.currentProfileIndex += 1
            this.showPanel()
        }
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
