import * as path from 'path'
import * as vscode from 'vscode'
import { onEvent } from '../utils'
import { OutputCoalescer } from './outputCoalescer'
import { TestProcessLog } from './testProcessLog'

export const testProcessLogViewType = 'julia-testprocess-log'

/** How long output is batched before being handed to a webview. */
const COALESCE_WINDOW_MS = 30

/**
 * What the view needs of a test process. Declared structurally rather than importing
 * `JuliaTestProcess`, both to keep this module out of a cycle with `testFeature.ts` and so the
 * tests can drive it without standing up a controller.
 */
export interface TestProcessLogSource {
    readonly id: string
    readonly packageName: string
    readonly log: TestProcessLog
}

/** One webview panel, tailing one test process's log. */
class TestProcessLogView implements vscode.Disposable {
    private subscriptions: vscode.Disposable[] = []
    private coalescer: OutputCoalescer
    // The webview cannot be written to until its script has run and asked for content: messages
    // posted before that are dropped on the floor, taking the replayed backlog with them.
    private ready = false

    constructor(
        public readonly panel: vscode.WebviewPanel,
        public readonly source: TestProcessLogSource,
        extensionPath: string
    ) {
        this.coalescer = new OutputCoalescer(COALESCE_WINDOW_MS, (text) =>
            this.panel.webview.postMessage({ type: 'append', text })
        )

        panel.webview.html = renderHtml(panel.webview, extensionPath)

        this.subscriptions.push(
            onEvent(panel.webview.onDidReceiveMessage, async (message) => {
                if (message?.type === 'ready') {
                    this.onReady()
                } else if (message?.type === 'copy' && typeof message.text === 'string') {
                    await vscode.env.clipboard.writeText(message.text)
                }
            }),
            onEvent(source.log.onDidAppend, (text) => {
                if (this.ready) {
                    this.coalescer.push(text)
                }
            }),
            // The theme's terminal palette is read from CSS variables inside the webview, so all
            // that is needed on a theme change is a nudge to read them again.
            onEvent(vscode.window.onDidChangeActiveColorTheme, () => this.panel.webview.postMessage({ type: 'theme' }))
        )
    }

    private onReady() {
        this.ready = true

        const config = vscode.workspace.getConfiguration('terminal.integrated')
        this.panel.webview.postMessage({
            type: 'font',
            fontFamily: config.get<string>('fontFamily') || undefined,
            fontSize: config.get<number>('fontSize') || undefined,
        })

        // Everything retained so far, in one write. A panel opened long after the fact, or
        // reopened after being closed, gets the same content as one that was open throughout.
        this.panel.webview.postMessage({ type: 'reset', text: this.source.log.getFullText() })
    }

    dispose() {
        this.coalescer.dispose()
        for (const i of this.subscriptions) {
            i.dispose()
        }
        this.subscriptions = []
    }
}

/**
 * The test process log views, one per process, keyed by process id.
 *
 * These replace the per process `OutputChannel`s: the Output view cannot render the ANSI
 * escapes the test processes now emit, and it disposed a channel the moment its process died —
 * exactly when the log is worth reading.
 */
export class TestProcessLogViewManager implements vscode.Disposable {
    private views = new Map<string, TestProcessLogView>()
    // The save command is contributed to the log tab's title bar, and a title bar command is
    // handed no arguments — so which log it acts on has to be tracked here.
    private activeId: string | undefined = undefined

    constructor(private extensionPath: string) {}

    /** The process whose log tab is currently focused, if one is. */
    getActiveSource(): TestProcessLogSource | undefined {
        return this.activeId === undefined ? undefined : this.views.get(this.activeId)?.source
    }

    /** Open the log for `source`, revealing the existing panel if there already is one. */
    show(source: TestProcessLogSource) {
        const existing = this.views.get(source.id)
        if (existing) {
            existing.panel.reveal(undefined, true)
            return
        }

        const panel = vscode.window.createWebviewPanel(
            testProcessLogViewType,
            `Test Process: ${source.packageName}`,
            { preserveFocus: true, viewColumn: vscode.ViewColumn.Active },
            {
                enableScripts: true,
                // Without this the webview is torn down whenever it is hidden and rebuilt empty,
                // since we have no serializer state to restore it from.
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(this.extensionPath)],
            }
        )
        panel.iconPath = new vscode.ThemeIcon('beaker')

        const view = new TestProcessLogView(panel, source, this.extensionPath)
        this.views.set(source.id, view)

        panel.onDidChangeViewState(() => {
            if (panel.active) {
                this.activeId = source.id
            } else if (this.activeId === source.id) {
                this.activeId = undefined
            }
        })

        panel.onDidDispose(() => {
            view.dispose()
            // Only if it is still ours: `closeFor` drops the entry before disposing the panel.
            if (this.views.get(source.id) === view) {
                this.views.delete(source.id)
            }
            if (this.activeId === source.id) {
                this.activeId = undefined
            }
        })
    }

    /** Whether a view is currently open for this process id. Used by the tests. */
    isOpen(id: string) {
        return this.views.has(id)
    }

    /** Close the views for these process ids, if any are open. */
    closeFor(ids: Iterable<string>) {
        for (const id of ids) {
            const view = this.views.get(id)
            if (view) {
                this.views.delete(id)
                if (this.activeId === id) {
                    this.activeId = undefined
                }
                view.panel.dispose()
            }
        }
    }

    dispose() {
        this.closeFor([...this.views.keys()])
    }
}

/**
 * Close any log tabs a previous session left persisted.
 *
 * These panels are deliberately *not* restorable: their test process died with the window that
 * owned it, so there would be nothing left to tail. Opting out is a matter of registering no
 * `WebviewPanelSerializer` — registering one is what makes VS Code persist a panel in the first
 * place, and an earlier version of this file registered a serializer that immediately disposed
 * what it was handed, which is what made the tabs flash past on every restart.
 *
 * This exists for the tabs that version already wrote into the workbench's restore state: VS Code
 * keeps persisting a webview it has revived once even after its reviver goes away, so without a
 * sweep they would linger, and there is no longer any reviver to close them.
 *
 * Called from the `TestFeature` constructor — the one moment at which every matching tab is
 * certainly stale, since our own view manager is built immediately afterwards.
 */
export function closeStaleTestProcessLogTabs() {
    const stale = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        // `endsWith` rather than `===`: VS Code namespaces the tab's view type, as in
        // `mainThreadWebview-julia-testprocess-log`.
        .filter(
            (tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(testProcessLogViewType)
        )

    if (stale.length > 0) {
        // `preserveFocus`, so a cleanup running at startup cannot move the cursor.
        void vscode.window.tabGroups.close(stale, true)
    }
}

function renderHtml(webview: vscode.Webview, extensionPath: string) {
    const asset = (...parts: string[]) => webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, ...parts)))

    const xtermCss = asset('libs', 'xterm', 'xterm.css')
    const xtermJs = asset('libs', 'xterm', 'xterm.js')
    const fitJs = asset('libs', 'xterm', 'addon-fit.js')
    const searchJs = asset('libs', 'xterm', 'addon-search.js')
    const logJs = asset('scripts', 'testprocess', 'log_webview.js')

    return `<!DOCTYPE html>
<html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; font-src ${webview.cspSource};">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Julia Test Process Log</title>
        <link href="${xtermCss}" rel="stylesheet" type="text/css">
        <style>
            html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
            body {
                background-color: var(
                    --vscode-terminal-background,
                    var(--vscode-panel-background, var(--vscode-editor-background))
                );
            }
            #terminal { height: 100%; width: 100%; padding: 4px 0 0 6px; box-sizing: border-box; }
            #find {
                display: none;
                position: absolute;
                top: 0;
                right: 18px;
                padding: 4px;
                background-color: var(--vscode-editorWidget-background);
                border: 1px solid var(--vscode-widget-border, transparent);
                box-shadow: 0 2px 8px var(--vscode-widget-shadow);
            }
            #find.visible { display: block; }
            #find-input {
                width: 220px;
                color: var(--vscode-input-foreground);
                background-color: var(--vscode-input-background);
                border: 1px solid var(--vscode-input-border, transparent);
                padding: 2px 4px;
                font-family: var(--vscode-font-family);
            }
        </style>
    </head>
    <body>
        <div id="terminal"></div>
        <div id="find"><input id="find-input" type="text" placeholder="Find (Enter / Shift+Enter)"></div>
        <script src="${xtermJs}"></script>
        <script src="${fitJs}"></script>
        <script src="${searchJs}"></script>
        <script src="${logJs}"></script>
    </body>
</html>`
}
