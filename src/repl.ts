import * as vscode from 'vscode';
import * as rpc from 'vscode-jsonrpc';
import * as path from 'path';
import * as net from 'net';
import * as os from 'os';
import * as vslc from 'vscode-languageclient';
import * as settings from './settings';
import * as juliaexepath from './juliaexepath';
import {generatePipeName, inferJuliaNumThreads} from './utils';
import * as telemetry from './telemetry';
import * as jlpkgenv from './jlpkgenv';
import * as fs from 'async-file';
import { Subject } from 'await-notify';

let g_context: vscode.ExtensionContext = null;
let g_settings: settings.ISettings = null;
let g_languageClient: vslc.LanguageClient = null;

let g_terminal: vscode.Terminal = null

let g_plots: Array<string> = new Array<string>();
let g_currentPlotIndex: number = 0;
let g_plotPanel: vscode.WebviewPanel | undefined = undefined;

let g_replVariables: string = '';

let c_juliaPlotPanelActiveContextKey = 'jlplotpaneFocus';

let g_connection: rpc.MessageConnection = undefined;

function getPlotPaneContent() {
    if (g_plots.length == 0) {
        return '<html></html>';
    }
    else {
        return g_plots[g_currentPlotIndex];
    }
}

function showPlotPane() {
    telemetry.traceEvent('command-showplotpane');
    let plotTitle = g_plots.length > 0 ? `Julia Plots (${g_currentPlotIndex+1}/${g_plots.length})` : "Julia Plots (0/0)";
    if (!g_plotPanel) {
        // Otherwise, create a new panel
        g_plotPanel = vscode.window.createWebviewPanel('jlplotpane', plotTitle, {preserveFocus: true, viewColumn: vscode.ViewColumn.Active}, {enableScripts: true});
        g_plotPanel.webview.html = getPlotPaneContent();
        vscode.commands.executeCommand('setContext', c_juliaPlotPanelActiveContextKey, true);

        // Reset when the current panel is closed
        g_plotPanel.onDidDispose(() => {
            g_plotPanel = undefined;
            vscode.commands.executeCommand('setContext', c_juliaPlotPanelActiveContextKey, false);
        }, null, g_context.subscriptions);

        g_plotPanel.onDidChangeViewState(({ webviewPanel }) => {
            vscode.commands.executeCommand('setContext', c_juliaPlotPanelActiveContextKey, webviewPanel.active);
        });
    }
    else {
        g_plotPanel.title = plotTitle;
        g_plotPanel.webview.html = getPlotPaneContent();
    }
}

function updatePlotPane() {
    showPlotPane();
}

export function plotPanePrev() {
    telemetry.traceEvent('command-plotpaneprevious');

    if (g_currentPlotIndex > 0) {
        g_currentPlotIndex = g_currentPlotIndex - 1;
        updatePlotPane();
    }
}

export function plotPaneNext() {
    telemetry.traceEvent('command-plotpanenext');

    if (g_currentPlotIndex < g_plots.length - 1) {
        g_currentPlotIndex = g_currentPlotIndex + 1;
        updatePlotPane();
    }
}

export function plotPaneFirst() {
    telemetry.traceEvent('command-plotpanefirst');

    if (g_plots.length > 0) {
        g_currentPlotIndex = 0;
        updatePlotPane();
    }
}

export function plotPaneLast() {
    telemetry.traceEvent('command-plotpanelast');
    if (g_plots.length > 0) {
        g_currentPlotIndex = g_plots.length - 1;
        updatePlotPane();
    }
}

export function plotPaneDel() {
    telemetry.traceEvent('command-plotpanedelete');
    if (g_plots.length > 0) {
        g_plots.splice(g_currentPlotIndex, 1);
        if (g_currentPlotIndex > g_plots.length - 1) {
            g_currentPlotIndex = g_plots.length - 1;
        }
        updatePlotPane();
    }
}

export function plotPaneDelAll() {
    telemetry.traceEvent('command-plotpanedeleteall');
    if (g_plots.length > 0) {
        g_plots.splice(0, g_plots.length);
        g_currentPlotIndex = 0;
        updatePlotPane();
    }
}

export class REPLTreeDataProvider implements vscode.TreeDataProvider<string> {
    private _onDidChangeTreeData: vscode.EventEmitter<string | undefined> = new vscode.EventEmitter<string | undefined>();
    readonly onDidChangeTreeData: vscode.Event<string | undefined> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getChildren(node?: string) {
        if (node) {
            return [node]
        }
        else {
            if (g_terminal) {
                return g_replVariables.split(';').slice(1)
            }
            else {
                return ['no repl attached']
            }
        }
    }

    getTreeItem(node: string): vscode.TreeItem {
        let treeItem: vscode.TreeItem = new vscode.TreeItem(node)
        return treeItem;
    }
}

// TODO Enable again
// let g_REPLTreeDataProvider: REPLTreeDataProvider = null;

function startREPLCommand() {
    telemetry.traceEvent('command-startrepl');

    startREPL(false);
}

function is_remote_env(): boolean {
    return typeof vscode.env.remoteName !== 'undefined'
}

function get_editor(): string {
    if (is_remote_env() || process.platform == 'darwin') {
        let cmd = vscode.env.appName.includes("Insiders") ? "code-insiders" : "code"
        return `"${path.join(vscode.env.appRoot, "bin", cmd)}"`
    }
    else {
        return `"${process.execPath}"`
    }
}
async function startREPL(preserveFocus: boolean) {
    if (g_terminal == null) {
        let pipename = generatePipeName(process.pid.toString(), 'vsc-julia-repl');

        let juliaIsConnectedPromise = startREPLMsgServer(pipename);

        let args = path.join(g_context.extensionPath, 'scripts', 'terminalserver', 'terminalserver.jl')
        let exepath = await juliaexepath.getJuliaExePath();
        let pkgenvpath = await jlpkgenv.getEnvPath();
        if (pkgenvpath==null) {
            let jlarg1 = ['-i','--banner=no'].concat(vscode.workspace.getConfiguration("julia").get("additionalArgs"))
            let jlarg2 = [
                args,
                pipename,
                vscode.workspace.getConfiguration("julia").get("useRevise").toString(),
                vscode.workspace.getConfiguration("julia").get("usePlotPane").toString(),
                telemetry.getCrashReportingPipename()
            ]
            g_terminal = vscode.window.createTerminal(
                {
                    name: "julia",
                    shellPath: exepath,
                    shellArgs: jlarg1.concat(jlarg2),
                    env: {
                        JULIA_EDITOR: get_editor(),
                        JULIA_NUM_THREADS: inferJuliaNumThreads()
                    }});
        }
        else {
            let env_file_paths = await jlpkgenv.getProjectFilePaths(pkgenvpath);

            let sysImageArgs = [];
            if (vscode.workspace.getConfiguration("julia").get("useCustomSysimage") && env_file_paths.sysimage_path && env_file_paths.project_toml_path && env_file_paths.manifest_toml_path) {
                let date_sysimage = await fs.stat(env_file_paths.sysimage_path);
                let date_manifest = await fs.stat(env_file_paths.manifest_toml_path);

                if (date_sysimage.mtime > date_manifest.mtime) {
                    sysImageArgs = ['-J', env_file_paths.sysimage_path]
                }
                else {
                    vscode.window.showWarningMessage('Julia sysimage for this environment is out-of-date and not used for REPL.')
                }
            }
            let jlarg1 = ['-i', '--banner=no', `--project=${pkgenvpath}`].concat(sysImageArgs).concat(vscode.workspace.getConfiguration("julia").get("additionalArgs"))
            let jlarg2 = [
                args,
                pipename,
                vscode.workspace.getConfiguration("julia").get("useRevise").toString(),
                vscode.workspace.getConfiguration("julia").get("usePlotPane").toString(),
                telemetry.getCrashReportingPipename()
            ]
            g_terminal = vscode.window.createTerminal(
                {
                    name: "julia",
                    shellPath: exepath,
                    shellArgs: jlarg1.concat(jlarg2),
                    env: {
                        JULIA_EDITOR: get_editor(),
                        JULIA_NUM_THREADS: inferJuliaNumThreads()
                    }});
        }
        g_terminal.show(preserveFocus);
        await juliaIsConnectedPromise.wait();
    }
    else {
    g_terminal.show(preserveFocus);
}
}

function debuggerRun(code: string) {
    let x = {
        type:'julia',
        request: 'attach',
        name: 'Julia REPL',
        code: code,
        stopOnEntry: false
    }
    vscode.debug.startDebugging(undefined, x);
}

function debuggerEnter(code: string) {
    let x = {
        type:'julia',
        request: 'attach',
        name: 'Julia REPL',
        code: code,
        stopOnEntry: true
    }
    vscode.debug.startDebugging(undefined, x);
}

function displayPlot(params: {kind: string, data: string}) {
    const kind = params.kind;
    const payload = params.data;

    if (kind == 'image/svg+xml') {
        g_currentPlotIndex = g_plots.push(payload) - 1;
        showPlotPane();
    }
    else if (kind == 'image/png') {
        let plotPaneContent = '<html><img src="data:image/png;base64,' + payload + '" /></html>';
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1;
        showPlotPane();
    }
    else if (kind == 'juliavscode/html') {
        g_currentPlotIndex = g_plots.push(payload) - 1;
        showPlotPane();
    }
    else if (kind == 'application/vnd.vegalite.v2+json') {
        showPlotPane();
        let uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')));
        let uriVegaLite = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-lite-2', 'vega-lite.min.js')));
        let uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-3', 'vega.min.js')));
        let plotPaneContent = `
            <html>
                <head>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaLite}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plotdiv" style="width:100%;height:100%;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega-lite",
                        actions: false
                    }
                    var spec = ${payload}
                    vegaEmbed('#plotdiv', spec, opt);
                </script>
            </html>`;
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1;
        showPlotPane();
    }
    else if (kind == 'application/vnd.vegalite.v3+json') {
        showPlotPane();
        let uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')));
        let uriVegaLite = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-lite-3', 'vega-lite.min.js')));
        let uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-5', 'vega.min.js')));
        let plotPaneContent = `
            <html>
                <head>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaLite}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plotdiv" style="width:100%;height:100%;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega-lite",
                        actions: false
                    }
                    var spec = ${payload}
                    vegaEmbed('#plotdiv', spec, opt);
                </script>
            </html>`;
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1;
        showPlotPane();
    }
    else if (kind == 'application/vnd.vegalite.v4+json') {
        showPlotPane();
        let uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')));
        let uriVegaLite = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-lite-4', 'vega-lite.min.js')));
        let uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-5', 'vega.min.js')));
        let plotPaneContent = `
            <html>
                <head>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaLite}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plotdiv" style="width:100%;height:100%;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega-lite",
                        actions: false
                    }
                    var spec = ${payload}
                    vegaEmbed('#plotdiv', spec, opt);
                </script>
            </html>`;
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1;
        showPlotPane();
    }
    else if (kind == 'application/vnd.vega.v3+json') {
        showPlotPane();
        let uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')));
        let uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-3', 'vega.min.js')));
        let plotPaneContent = `
            <html>
                <head>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plotdiv" style="width:100%;height:100%;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega",
                        actions: false
                    }
                    var spec = ${payload}
                    vegaEmbed('#plotdiv', spec, opt);
                </script>
            </html>`;
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1;
        showPlotPane();
    }
    else if (kind == 'application/vnd.vega.v4+json') {
        showPlotPane();
        let uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')));
        let uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-4', 'vega.min.js')));
        let plotPaneContent = `
            <html>
                <head>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plotdiv" style="width:100%;height:100%;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega",
                        actions: false
                    }
                    var spec = ${payload}
                    vegaEmbed('#plotdiv', spec, opt);
                </script>
            </html>`;
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1;
        showPlotPane();
    }
    else if (kind == 'application/vnd.vega.v5+json') {
        showPlotPane();
        let uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')));
        let uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-5', 'vega.min.js')));
        let plotPaneContent = `
            <html>
                <head>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plotdiv" style="width:100%;height:100%;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega",
                        actions: false
                    }
                    var spec = ${payload}
                    vegaEmbed('#plotdiv', spec, opt);
                </script>
            </html>`;
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1;
        showPlotPane();
    }
    else if (kind == 'application/vnd.plotly.v1+json') {
        showPlotPane();
        let uriPlotly = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'plotly', 'plotly.min.js')));
        let plotPaneContent = `
        <html>
        <head>
            <script src="${uriPlotly}"></script>
        </head>
        <body>
        </body>
        <script type="text/javascript">
            gd = (function() {
                var WIDTH_IN_PERCENT_OF_PARENT = 100
                var HEIGHT_IN_PERCENT_OF_PARENT = 100;
                var gd = Plotly.d3.select('body')
                    .append('div').attr("id", "plotdiv")
                    .style({
                        width: WIDTH_IN_PERCENT_OF_PARENT + '%',
                        'margin-left': (100 - WIDTH_IN_PERCENT_OF_PARENT) / 2 + '%',
                        height: HEIGHT_IN_PERCENT_OF_PARENT + 'vh',
                        'margin-top': (100 - HEIGHT_IN_PERCENT_OF_PARENT) / 2 + 'vh'
                    })
                    .node();
                var spec = ${payload};
                Plotly.newPlot(gd, spec.data, spec.layout);
                window.onresize = function() {
                    Plotly.Plots.resize(gd);
                    };
                return gd;
            })();
        </script>
        </html>`;
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1;
        showPlotPane();
    }
    else if (kind == 'application/vnd.dataresource+json') {
        let grid_panel = vscode.window.createWebviewPanel('jlgrid', 'Julia Table', {preserveFocus: true, viewColumn: vscode.ViewColumn.Active}, {enableScripts: true, retainContextWhenHidden: true});

        let uriAgGrid = grid_panel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'ag-grid', 'ag-grid-community.min.noStyle.js')));
        let uriAgGridCSS = grid_panel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'ag-grid', 'ag-grid.css')));
        let uriAgGridTheme = grid_panel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'ag-grid', 'ag-theme-balham.css')));
        let grid_content = `
            <html>
                <head>
                    <script src="${uriAgGrid}"></script>
                    <style> html, body { margin: 0; padding: 0; height: 100%; } </style>
                    <link rel="stylesheet" href="${uriAgGridCSS}">
                    <link rel="stylesheet" href="${uriAgGridTheme}">
                </head>
            <body>
                <div id="myGrid" style="height: 100%; width: 100%;" class="ag-theme-balham"></div>
            </body>
            <script type="text/javascript">
                var payload = ${payload};
                var gridOptions = {
                    onGridReady: event => event.api.sizeColumnsToFit(),
                    onGridSizeChanged: event => event.api.sizeColumnsToFit(),
                    defaultColDef: {
                        resizable: true,
                        filter: true,
                        sortable: true
                    },
                    columnDefs: payload.schema.fields.map(function(x) {
                        if (x.type == "number" || x.type == "integer") {
                            return {
                                field: x.name,
                                type: "numericColumn",
                                filter: "agNumberColumnFilter"
                            };
                        } else if (x.type == "date") {
                            return {
                                field: x.name,
                                filter: "agDateColumnFilter"
                            };
                        } else {
                            return {field: x.name};
                        };
                    }),
                rowData: payload.data
                };
                var eGridDiv = document.querySelector('#myGrid');
                new agGrid.Grid(eGridDiv, gridOptions);
            </script>
        </html>
        `;
        
        grid_panel.webview.html = grid_content;
    }
    else {
        throw new Error();
    }
}

const notifyTypeDisplay = new rpc.NotificationType<{kind: string, data: any}, void>('display');
const notifyTypeDebuggerEnter = new rpc.NotificationType<string, void>('debugger/enter');
const notifyTypeDebuggerRun = new rpc.NotificationType<string, void>('debugger/run');
const notifyTypeReplRunCode = new rpc.NotificationType<{filename: string, line: number, column: number, code: string}, void>('repl/runcode');
const notifyTypeReplStartDebugger = new rpc.NotificationType<string, void>('repl/startdebugger');

function startREPLMsgServer(pipename: string) {
    let connected = new Subject();

    let server = net.createServer((socket: net.Socket) => {
        socket.on('close', hadError => {server.close()});

        g_connection = rpc.createMessageConnection(
            new rpc.StreamMessageReader(socket),
            new rpc.StreamMessageWriter(socket)
            );

        g_connection.onNotification(notifyTypeDisplay, displayPlot);
        g_connection.onNotification(notifyTypeDebuggerRun, debuggerRun);
        g_connection.onNotification(notifyTypeDebuggerEnter, debuggerEnter);

        g_connection.listen();

        connected.notify();
    });

    server.listen(pipename);

    return connected;
}

async function executeCode(text, individualLine) {
    if (!text.endsWith("\n")) {
        text = text + '\n';
    }

    await startREPL(true);
    g_terminal.show(true);
    var lines = text.split(/\r?\n/);
    lines = lines.filter(line => line != '');
    text = lines.join('\n');
    if (individualLine || process.platform == "win32") {
        g_terminal.sendText(text + '\n', false);
    }
    else {
        g_terminal.sendText('\u001B[200~' + text + '\n' + '\u001B[201~', false);
    }
}

function executeSelection() {
    telemetry.traceEvent('command-executejuliacodeinrepl');

    var editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    var selection = editor.selection;

    var text = selection.isEmpty ? editor.document.lineAt(selection.start.line).text : editor.document.getText(selection);

    // If no text was selected, try to move the cursor to the end of the next line
    if (selection.isEmpty) {
        for (var line = selection.start.line + 1; line < editor.document.lineCount; line++) {
            if (!editor.document.lineAt(line).isEmptyOrWhitespace) {
                var newPos = selection.active.with(line, editor.document.lineAt(line).range.end.character);
                var newSel = new vscode.Selection(newPos, newPos);
                editor.selection = newSel;
                break;
            }
        }
    }
    executeCode(text, selection.isEmpty)
}

async function executeInRepl(code: string, filename: string, start: vscode.Position) {
    await startREPL(true);

    g_connection.sendNotification(
        notifyTypeReplRunCode,
        {
            filename: filename,
            line: start.line,
            column: start.character,
            code: code
        }
    );
}

async function executeFile(uri?: vscode.Uri) {
    telemetry.traceEvent('command-executejuliafileinrepl');

    let path = "";
    let code = "";
    if (uri) {
        path = uri.fsPath;
        const readBytes = await vscode.workspace.fs.readFile(uri);
        code = Buffer.from(readBytes).toString('utf8');
    }
    else {
        let editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        path = editor.document.fileName;
        code = editor.document.getText();
    }
    executeInRepl(code, path, new vscode.Position(0, 0));
}

async function selectJuliaBlock() {
    if (g_languageClient == null) {
        vscode.window.showErrorMessage('Error: Language server is not running.');
    }
    else {
        var editor = vscode.window.activeTextEditor;
        let params: TextDocumentPositionParams = { textDocument: vslc.TextDocumentIdentifier.create(editor.document.uri.toString()), position: new vscode.Position(editor.selection.start.line, editor.selection.start.character) }

        try {
            let ret_val: vscode.Position[] = await g_languageClient.sendRequest('julia/getCurrentBlockRange', params);

            let start_pos = new vscode.Position(ret_val[0].line, ret_val[0].character)
            let end_pos = new vscode.Position(ret_val[1].line, ret_val[1].character)
            vscode.window.activeTextEditor.selection = new vscode.Selection(start_pos, end_pos)
            vscode.window.activeTextEditor.revealRange(new vscode.Range(start_pos, end_pos))
        }
        catch (ex) {
            if (ex.message == "Language client is not ready yet") {
                vscode.window.showErrorMessage('Select code block only works once the Julia Language Server is ready.');
            }
            else {
                throw ex;
            }
        }
    }
}

async function executeJuliaCellInRepl() {
    telemetry.traceEvent('command-executejuliacellinrepl');

    let ed = vscode.window.activeTextEditor;
    let doc = ed.document;
    let rx = new RegExp("^##");
    let curr = doc.validatePosition(ed.selection.active).line;
    var start = curr;
    while (start >= 0) {
        if (rx.test(doc.lineAt(start).text)) {
            break;
        } else {
            start -= 1;
        }
    }
    start += 1;
    var end = start;
    while (end < doc.lineCount) {
        if (rx.test(doc.lineAt(end).text)) {
            break;
        } else {
            end += 1;
        }
    }
    end -= 1;
    let startpos = new vscode.Position(start, 0);
    let endpos = new vscode.Position(end, doc.lineAt(end).text.length);
    let nextpos = new vscode.Position(end + 1, 0);
    let code = doc.getText(new vscode.Range(startpos, endpos));
    executeInRepl(code, doc.fileName, startpos)
    vscode.window.activeTextEditor.selection = new vscode.Selection(nextpos, nextpos)
    vscode.window.activeTextEditor.revealRange(new vscode.Range(nextpos, nextpos))
}

async function executeJuliaBlockInRepl() {
    telemetry.traceEvent('command-executejuliablockinrepl');

    var editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    var selection = editor.selection;

    if (selection.isEmpty && g_languageClient == null) {
        vscode.window.showErrorMessage('Error: Language server is not running.');
    }
    else if (!selection.isEmpty) {
        let code_to_run = editor.document.getText(selection);

        executeInRepl(code_to_run, editor.document.fileName, selection.start);
    }
    else {
        var editor = vscode.window.activeTextEditor;
        let params: TextDocumentPositionParams = { textDocument: vslc.TextDocumentIdentifier.create(editor.document.uri.toString()), position: new vscode.Position(editor.selection.start.line, editor.selection.start.character) }

        try {
            let ret_val: vscode.Position[] = await g_languageClient.sendRequest('julia/getCurrentBlockRange', params);

            let start_pos = new vscode.Position(ret_val[0].line, ret_val[0].character)
            let end_pos = new vscode.Position(ret_val[1].line, ret_val[1].character)
            let next_pos = new vscode.Position(ret_val[2].line, ret_val[2].character)
            
            let code_to_run = vscode.window.activeTextEditor.document.getText(new vscode.Range(start_pos, end_pos))
            executeInRepl(code_to_run, vscode.window.activeTextEditor.document.fileName, start_pos)

            vscode.window.activeTextEditor.selection = new vscode.Selection(next_pos, next_pos)
            vscode.window.activeTextEditor.revealRange(new vscode.Range(next_pos, next_pos))
        }
        catch (ex) {
            if (ex.message == "Language client is not ready yet") {
                vscode.window.showErrorMessage('Execute code block only works once the Julia Language Server is ready.');
            }
            else {
                throw ex;
            }
        }
    }
}

export async function decorateSelection() {
    if (vscode.workspace.getConfiguration('julia').get('highlightCurrentBlock')) {
        let doc = vscode.window.activeTextEditor;
        let decor :vscode.DecorationOptions[] = [];

        let ret_val: vscode.Position[] = await g_languageClient.sendRequest('julia/getCurrentBlockRange', { textDocument: vslc.TextDocumentIdentifier.create(doc.document.uri.toString()), position: new vscode.Position(doc.selection.start.line, doc.selection.start.character) });
        let start_pos = new vscode.Position(ret_val[0].line, ret_val[0].character)
        let end_pos = new vscode.Position(ret_val[1].line, ret_val[1].character)
        let rng = new vscode.Range(start_pos, end_pos);

        decor.push({range: rng});
        doc.setDecorations(CurrentBlockDecor, decor)
}
}

const CurrentBlockDecor = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.inactiveSelectionBackground"), 
    isWholeLine: true
});


export async function replStartDebugger(pipename: string) {
    await startREPL(true)

    g_connection.sendNotification(notifyTypeReplStartDebugger, pipename);
}

export interface TextDocumentPositionParams {
    textDocument: vslc.TextDocumentIdentifier
    position: vscode.Position
}

let getBlockText = new rpc.RequestType<TextDocumentPositionParams, void, void, void>('julia/getCurrentBlockRange')

export function activate(context: vscode.ExtensionContext, settings: settings.ISettings) {
    g_context = context;
    g_settings = settings;

    // TODO Enable again
    // g_REPLTreeDataProvider = new REPLTreeDataProvider();
    // context.subscriptions.push(vscode.window.registerTreeDataProvider('REPLVariables', g_REPLTreeDataProvider));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.startREPL', startREPLCommand));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.executeJuliaCodeInREPL', executeSelection));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.executeJuliaFileInREPL', executeFile));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.executeJuliaCellInREPL', executeJuliaCellInRepl));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.executeJuliaBlockInREPL', executeJuliaBlockInRepl));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.selectBlock', selectJuliaBlock));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.show-plotpane', showPlotPane));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.plotpane-previous', plotPanePrev));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.plotpane-next', plotPaneNext));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.plotpane-first', plotPaneFirst));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.plotpane-last', plotPaneLast));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.plotpane-delete', plotPaneDel));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.plotpane-delete-all', plotPaneDelAll));

    vscode.window.onDidCloseTerminal(terminal => {
        if (terminal == g_terminal) {
            g_terminal = null;
        }
    })
}

export function onDidChangeConfiguration(newSettings: settings.ISettings) {

}

export function onNewLanguageClient(newLanguageClient: vslc.LanguageClient) {
    g_languageClient = newLanguageClient;
}
