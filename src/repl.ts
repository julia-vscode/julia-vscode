import * as vscode from 'vscode';
import * as rpc from 'vscode-jsonrpc';
import * as path from 'path';
import * as net from 'net';
import * as os from 'os';
import * as vslc from 'vscode-languageclient';
import * as settings from './settings';

let g_context: vscode.ExtensionContext = null;
let g_settings: settings.ISettings = null;
let g_languageClient: vslc.LanguageClient = null;

let g_terminal: vscode.Terminal = null

let g_plots: Array<string> = new Array<string>();
let g_currentPlotIndex: number = 0;

let g_replVariables: string = '';

export class PlotPaneDocumentContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    public provideTextDocumentContent(uri: vscode.Uri): string {
        if (g_plots.length == 0) {
            return '<html></html>';
        }
        else {
            return g_plots[g_currentPlotIndex];
        }
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public update() {
        this._onDidChange.fire(vscode.Uri.parse('jlplotpane://nothing.html'));
    }
}

let g_plotPaneProvider: PlotPaneDocumentContentProvider = null;

export function showPlotPane() {
    let uri = vscode.Uri.parse('jlplotpane://nothing.html');
    vscode.commands.executeCommand('vscode.previewHtml', uri, undefined, "julia Plot Pane");
}

export function plotPanePrev() {
    if (g_currentPlotIndex > 0) {
        g_currentPlotIndex = g_currentPlotIndex - 1;
        g_plotPaneProvider.update();
    }
}

export function plotPaneNext() {
    if (g_currentPlotIndex < g_plots.length - 1) {
        g_currentPlotIndex = g_currentPlotIndex + 1;
        g_plotPaneProvider.update();
    }
}

export function plotPaneFirst() {
    if (g_plots.length > 0) {
        g_currentPlotIndex = 0;
        g_plotPaneProvider.update();
    }
}

export function plotPaneLast() {
    if (g_plots.length > 0) {
        g_currentPlotIndex = g_plots.length - 1;
        g_plotPaneProvider.update();
    }
}

export function plotPaneDel() {
    if (g_plots.length > 0) {
        g_plots.splice(g_currentPlotIndex, 1);
        if (g_currentPlotIndex > g_plots.length - 1) {
            g_currentPlotIndex = g_plots.length - 1;
        }
        g_plotPaneProvider.update();
    }
}

function generatePipeName(pid: string, name: string) {
    if (process.platform === 'win32') {
        return '\\\\.\\pipe\\' + name + '-' + pid;
    }
    else {
        return path.join(os.tmpdir(), name + '-' + pid);
    }
}

export class REPLTreeDataProvider implements vscode.TreeDataProvider<string> {
    private _onDidChangeTreeData: vscode.EventEmitter<string | undefined> = new vscode.EventEmitter<string | undefined>();
    readonly onDidChangeTreeData: vscode.Event<string | undefined> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getChildren(node?: string) {
        if (node) {
            return [node]
        }
        else {
            if (g_terminal) {
                return g_replVariables.split(',').slice(1)
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

let g_REPLTreeDataProvider: REPLTreeDataProvider = null;

function startREPL() {
    if (g_terminal == null) {
        startREPLConn()
        startPlotDisplayServer()
        let args = path.join(g_context.extensionPath, 'scripts', 'terminalserver', 'terminalserver.jl')
        g_terminal = vscode.window.createTerminal("julia", g_settings.juliaExePath, ['-q', '-i', args, process.pid.toString()]);
    }
    g_terminal.show();
}

function startREPLConn() {
    let PIPE_PATH = generatePipeName(process.pid.toString(), 'vscode-language-julia-fromrepl');

    var server = net.createServer(function (stream) {
        let accumulatingBuffer = new Buffer(0);

        stream.on('data', async function (c) {
            accumulatingBuffer = Buffer.concat([accumulatingBuffer, Buffer.from(c)]);
            let bufferResult = accumulatingBuffer.toString()
            let replResponse = accumulatingBuffer.toString().split(",")

            if (replResponse[0] == "repl/returnModules") {
                let result = await vscode.window.showQuickPick(replResponse.slice(1), { placeHolder: 'Switch to Module...' })
                if (result != undefined) {
                    sendMessage('repl/changeModule', result)
                }
            }
            if (replResponse[0] == "repl/variables") {
                g_replVariables = bufferResult;
                g_REPLTreeDataProvider.refresh();
            }
        });
    });

    server.on('close', function () {
        console.log('Server: on close');
    })

    server.listen(PIPE_PATH, function () {
        console.log('Server: on listening');
    })
}

function startPlotDisplayServer() {
    let PIPE_PATH = generatePipeName(process.pid.toString(), 'vscode-language-julia-terminal');

    var server = net.createServer(function (stream) {
        let accumulatingBuffer = new Buffer(0);

        stream.on('data', function (c) {
            accumulatingBuffer = Buffer.concat([accumulatingBuffer, Buffer.from(c)]);
            let s = accumulatingBuffer.toString();
            let index_of_sep_1 = s.indexOf(":");
            let index_of_sep_2 = s.indexOf(";");

            if (index_of_sep_2 > -1) {
                let mime_type = s.substring(0, index_of_sep_1);
                let msg_len_as_string = s.substring(index_of_sep_1 + 1, index_of_sep_2);
                let msg_len = parseInt(msg_len_as_string);
                if (accumulatingBuffer.length >= mime_type.length + msg_len_as_string.length + 2 + msg_len) {
                    let actual_image = s.substring(index_of_sep_2 + 1);
                    if (accumulatingBuffer.length > mime_type.length + msg_len_as_string.length + 2 + msg_len) {
                        accumulatingBuffer = Buffer.from(accumulatingBuffer.slice(mime_type.length + msg_len_as_string.length + 2 + msg_len + 1));
                    }
                    else {
                        accumulatingBuffer = new Buffer(0);
                    }

                    if (mime_type == 'image/svg+xml') {
                        g_currentPlotIndex = g_plots.push(actual_image) - 1;
                    }
                    else if (mime_type == 'image/png') {
                        let plotPaneContent = '<html><img src="data:image/png;base64,' + actual_image + '" /></html>';
                        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1;
                    }
                    else {
                        throw new Error();
                    }

                    let uri = vscode.Uri.parse('jlplotpane://nothing.html');
                    g_plotPaneProvider.update();
                    vscode.commands.executeCommand('vscode.previewHtml', uri, undefined, "julia Plot Pane");
                }
            }
        });
    });

    server.on('close', function () {
        console.log('Server: on close');
    })

    server.listen(PIPE_PATH, function () {
        console.log('Server: on listening');
    })
}

function executeCode(text) {
    if (!text.endsWith("\n")) {
        text = text + '\n';
    }

    startREPL();
    g_terminal.show(true);
    var lines = text.split(/\r?\n/);
    lines = lines.filter(line => line != '');
    text = lines.join('\n');
    g_terminal.sendText(text + '\n', false);
}

function executeSelection() {
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
    executeCode(text)
    editor.show()
}

function executeFile() {
    var editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    sendMessage('repl/include', editor.document.fileName)
}

function executeJuliaBlockInRepl() {
    if (g_languageClient == null) {
        vscode.window.showErrorMessage('Error: Language server is not running.');
    }
    else {
        var editor = vscode.window.activeTextEditor;
        let params: TextDocumentPositionParams = { textDocument: vslc.TextDocumentIdentifier.create(editor.document.uri.toString()), position: new vscode.Position(editor.selection.start.line, editor.selection.start.character) }
        g_languageClient.sendRequest('julia/getCurrentBlockText', params).then((text) => {
            executeCode(text)
            vscode.window.showTextDocument(vscode.window.activeTextEditor.document)
        })
    }
}

function changeREPLmode() {
    sendMessage('repl/getAvailableModules', '');
    vscode.window.showTextDocument(vscode.window.activeTextEditor.document);
}

function sendMessage(cmd, msg: string) {
    startREPL()
    let sock = generatePipeName(process.pid.toString(), 'vscode-language-julia-torepl')

    let conn = net.connect(sock)
    conn.write(cmd + '\n' + msg + "\nrepl/endMessage")
    conn.on('error', () => { vscode.window.showErrorMessage("REPL is not open") })
}

export interface TextDocumentPositionParams {
    textDocument: vslc.TextDocumentIdentifier
    position: vscode.Position
}

let getBlockText = new rpc.RequestType<TextDocumentPositionParams, void, void, void>('julia/getCurrentBlockText')

export function activate(context: vscode.ExtensionContext, settings: settings.ISettings) {
    g_context = context;
    g_settings = settings;

    g_plotPaneProvider = new PlotPaneDocumentContentProvider();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('jlplotpane', g_plotPaneProvider));

    g_REPLTreeDataProvider = new REPLTreeDataProvider();
    context.subscriptions.push(vscode.window.registerTreeDataProvider('REPLVariables', g_REPLTreeDataProvider));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.startREPL', startREPL));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.executeJuliaCodeInREPL', executeSelection));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.executeJuliaFileInREPL', executeFile));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.change-repl-module', changeREPLmode));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.executeJuliaBlockInREPL', executeJuliaBlockInRepl));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.show-plotpane', showPlotPane));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.plotpane-previous', plotPanePrev));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.plotpane-next', plotPaneNext));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.plotpane-first', plotPaneFirst));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.plotpane-last', plotPaneLast));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.plotpane-delete', plotPaneDel));

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
