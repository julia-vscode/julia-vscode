'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'async-file';
import * as path from 'path'
import * as net from 'net';
import * as os from 'os';
var kill = require('async-child-process').kill;
var exec = require('child-process-promise').exec;
var tempfs = require('promised-temp').track();
import { spawn, ChildProcess } from 'child_process';
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TransportKind, StreamInfo } from 'vscode-languageclient';
import * as rpc from 'vscode-jsonrpc';

let juliaExecutable = null;
let juliaPackagePath: string = null;
let languageClient: LanguageClient = null;
let REPLterminal: vscode.Terminal = null;
let extensionPath: string = null;
let g_context: vscode.ExtensionContext = null;
let lastWeaveContent: string = null;
let weaveOutputChannel: vscode.OutputChannel = null;
let weaveChildProcess: ChildProcess = null;
let weaveNextChildProcess: ChildProcess = null;
let plots: Array<string> = new Array<string>();
let currentPlotIndex: number = 0;
let serverstatus: vscode.StatusBarItem = null;
let serverBusyNotification = new rpc.NotificationType<string, void>('window/setStatusBusy');
let serverReadyNotification = new rpc.NotificationType<string, void>('window/setStatusReady');
let taskProvider: vscode.Disposable | undefined;

export class WeaveDocumentContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return lastWeaveContent;
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public update() {
        
        this._onDidChange.fire(vscode.Uri.parse('jlweave://nothing.html'));
    }
}

let weaveProvider: WeaveDocumentContentProvider = null;

export class PlotPaneDocumentContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    public provideTextDocumentContent(uri: vscode.Uri): string {
        if(plots.length==0) {
            return '<html></html>';
        }
        else {
            return plots[currentPlotIndex];
        }
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public update() {
        
        this._onDidChange.fire(vscode.Uri.parse('jlplotpane://nothing.html'));
    }
}

let plotPaneProvider: PlotPaneDocumentContentProvider = null;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    g_context = context;
    extensionPath = context.extensionPath;
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Activating extension language-julia');

    loadConfiguration();

    let disposable_configchange = vscode.workspace.onDidChangeConfiguration(configChanged);
    context.subscriptions.push(disposable_configchange);

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable_OpenPkgCommand = vscode.commands.registerCommand('language-julia.openPackageDirectory', openPackageDirectoryCommand);
    context.subscriptions.push(disposable_OpenPkgCommand);

    let disposable_StartREPLCommand = vscode.commands.registerCommand('language-julia.startREPL', startREPLCommand);
    context.subscriptions.push(disposable_StartREPLCommand);

    let weave_open_preview = vscode.commands.registerCommand('language-julia.weave-open-preview', weave_open_preview_Command);
    context.subscriptions.push(weave_open_preview);

    let weave_open_preview_side = vscode.commands.registerCommand('language-julia.weave-open-preview-side', weave_open_preview_side_Command);
    context.subscriptions.push(weave_open_preview_side);

    let weave_save = vscode.commands.registerCommand('language-julia.weave-save', weave_save_Command);
    context.subscriptions.push(weave_save);

    let applytextedit = vscode.commands.registerCommand('language-julia.applytextedit', applyTextEdit);
    context.subscriptions.push(applytextedit);

    let lintpkg = vscode.commands.registerCommand('language-julia.lint-package', lintPackage);
    context.subscriptions.push(lintpkg);

    let reloadmodules = vscode.commands.registerCommand('language-julia.reload-modules', reloadModules);
    context.subscriptions.push(lintpkg);

    let showplotpane = vscode.commands.registerCommand('language-julia.show-plotpane', showPlotPane);
    context.subscriptions.push(showplotpane);

    let plotpaneprev = vscode.commands.registerCommand('language-julia.plotpane-previous', plotPanePrev);
    context.subscriptions.push(plotpaneprev);

    let plotpanenext = vscode.commands.registerCommand('language-julia.plotpane-next', plotPaneNext);
    context.subscriptions.push(plotpanenext);

    let plotpanefirst = vscode.commands.registerCommand('language-julia.plotpane-first', plotPaneFirst);
    context.subscriptions.push(plotpanefirst);

    let plotpanelast = vscode.commands.registerCommand('language-julia.plotpane-last', plotPaneLast);
    context.subscriptions.push(plotpanelast);

    let plotpanedel = vscode.commands.registerCommand('language-julia.plotpane-delete', plotPaneDel);
    context.subscriptions.push(plotpanedel);

    // context.subscriptions.push(vscode.commands.registerCommand('language-julia.change-repl-module', changeREPLModule));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.change-repl-module', () => sendMessageToREPL('repl/getAvailableModules')));
    
    serverstatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);   
    serverstatus.show()
    serverstatus.text = 'Julia: starting up';
    context.subscriptions.push(serverstatus);

    startREPLconnectionServer();
    startREPLConn();

    weaveProvider = new WeaveDocumentContentProvider();
    let disposable_weaveProvider = vscode.workspace.registerTextDocumentContentProvider('jlweave', weaveProvider);
    context.subscriptions.push(disposable_weaveProvider);

    plotPaneProvider = new PlotPaneDocumentContentProvider();
    let disposable_plotPaneProvider = vscode.workspace.registerTextDocumentContentProvider('jlplotpane', plotPaneProvider);
    context.subscriptions.push(disposable_plotPaneProvider);

    let disposable_executeJuliaCodeInREPL = vscode.commands.registerCommand('language-julia.executeJuliaCodeInREPL', executeJuliaCodeInREPL);
    context.subscriptions.push(disposable_executeJuliaCodeInREPL);

    let disposable_toggleLinter = vscode.commands.registerCommand('language-julia.toggleLinter', toggleLinter);
    context.subscriptions.push(disposable_toggleLinter);

    vscode.window.onDidCloseTerminal(terminal=>{
        if (terminal==REPLterminal) {
            REPLterminal = null;
        }
    })
    vscode.languages.setLanguageConfiguration('julia', {
        indentationRules: {
            increaseIndentPattern: /^(\s*|.*=\s*|.*@\w*\s*)[\w\s]*\b(if|while|for|function|macro|immutable|struct|type|let|quote|try|begin|.*\)\s*do|else|elseif|catch|finally)\b(?!.*\bend\b[^\]]*$).*$/,
            decreaseIndentPattern: /^\s*(end|else|elseif|catch|finally)\b.*$/
        }
    });
    startLanguageServer();

    taskProvider = vscode.workspace.registerTaskProvider('julia', {
        provideTasks: () => {
            return getJuliaTasks();
        },
        resolveTask(_task: vscode.Task): vscode.Task | undefined {
            return undefined;
        }
    });
}

// this method is called when your extension is deactivated
export function deactivate() {
}

function configChanged(params) {
    let need_to_restart_server = loadConfiguration();

    if(need_to_restart_server) {
        if(languageClient!=null) {
            languageClient.stop();
            languageClient = null;
        }

        startLanguageServer();
    }
}

function loadConfiguration() {
    let oldValue = juliaExecutable;

    let section = vscode.workspace.getConfiguration('julia');
    if (section) {
        juliaExecutable = section.get<string>('executablePath', null);
    }
    else {
        juliaExecutable = null;
    }

    if(juliaExecutable != oldValue) {
        juliaPackagePath = null;
    }
    return juliaExecutable != oldValue
}

async function getPkgPath() {
    if(juliaPackagePath==null) {
        var res = await exec(`"${juliaExecutable}" -e "println(Pkg.dir())"`);
        juliaPackagePath = res.stdout.trim();
    }
    return juliaPackagePath;
}

async function startLanguageServer() {
    // let debugOptions = { execArgv: ["--nolazy", "--debug=6004"] };

    try {
        var originalJuliaPkgDir = await getPkgPath();
    }
    catch (e) {
        vscode.window.showErrorMessage('Could not start the julia language server. Make sure the configuration setting julia.executablePath points to the julia binary.');
        return;
    }
    let serverArgsRun = ['--startup-file=no', '--history-file=no', 'main.jl', originalJuliaPkgDir, '--debug=no'];
    let serverArgsDebug = ['--startup-file=no', '--history-file=no', 'main.jl', originalJuliaPkgDir, '--debug=yes'];
    let spawnOptions = {
        cwd: path.join(extensionPath, 'scripts', 'languageserver'),
        env: {
            JULIA_PKGDIR: path.join(extensionPath, 'scripts', 'languageserver', 'julia_pkgdir'),
            HOME: process.env.HOME ? process.env.HOME : os.homedir()
        }
    };


    let serverOptions = {
        run: { command: juliaExecutable, args: serverArgsRun, options: spawnOptions },
        debug: { command: juliaExecutable, args: serverArgsDebug, options: spawnOptions }
    };

    let clientOptions: LanguageClientOptions = {
        // Register the server for plain text documents
        documentSelector: ['julia', 'juliamarkdown'],
        synchronize: {
            configurationSection: 'julia.runlinter',
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.jl')
        }
    }

    // Create the language client and start the client.
    languageClient = new LanguageClient('julia Language Server', serverOptions, clientOptions);

    // Push the disposable to the context's subscriptions so that the 
    // client can be deactivated on extension deactivation
    try {
        g_context.subscriptions.push(languageClient.start());
    }
    catch (e) {
        vscode.window.showErrorMessage('Could not start the julia language server. Make sure the configuration setting julia.executablePath points to the julia binary.');
        languageClient = null;
    }
    languageClient.onReady().then(()=>{
        languageClient.onNotification(serverBusyNotification, setStatusBusy)
        languageClient.onNotification(serverReadyNotification, setStatusReady)
    })
}

function setStatusBusy() {
    serverstatus.text = 'Julia: busy'
}

function setStatusReady() {
    serverstatus.text = 'Julia: ready'
}

// This method implements the language-julia.openPackageDirectory command
async function openPackageDirectoryCommand() {
    const optionsPackage: vscode.QuickPickOptions = {
        placeHolder: 'Select package'
    };

    try {
        var juliaVersionHomeDir = await getPkgPath();        

        let files = await fs.readdir(juliaVersionHomeDir);

        let filteredPackages = files.filter(path => !path.startsWith('.') && ['METADATA', 'REQUIRE', 'META_BRANCH'].indexOf(path) < 0);

        if (filteredPackages.length == 0) {
            vscode.window.showInformationMessage('Error: There are no packages installed.');
        }
        else {
            let resultPackage = await vscode.window.showQuickPick(filteredPackages, optionsPackage);

            if (resultPackage !== undefined) {
                var folder = vscode.Uri.file(path.join(juliaVersionHomeDir, resultPackage));

                try {
                    await vscode.commands.executeCommand('vscode.openFolder', folder, true);
                }
                catch (e) {
                    vscode.window.showInformationMessage('Could not open the package.');
                }
            }
        }
    }
    catch (e) {
        vscode.window.showInformationMessage('Error: Could not read package directory.');
    }
}

async function weave_core(column, selected_format:string=undefined) {
    let parsed_filename = path.parse(vscode.window.activeTextEditor.document.fileName);

    let source_filename: string;
    let output_filename: string;
    if (selected_format===undefined) {
        let temporary_dirname = await tempfs.mkdir("julia-vscode-weave");

        source_filename = path.join(temporary_dirname, 'source-file.jmd')

        await fs.writeFile(source_filename, vscode.window.activeTextEditor.document.getText(), 'utf8');
    
        output_filename = path.join(temporary_dirname, 'output-file.html');
    }
    else {
        source_filename = vscode.window.activeTextEditor.document.fileName;
        output_filename = '';
    }

    if (weaveOutputChannel == null) {
        weaveOutputChannel = vscode.window.createOutputChannel("julia Weave");
    }
    weaveOutputChannel.clear();
    weaveOutputChannel.show(true);

    if (weaveChildProcess != null) {
        try {
            await kill(weaveChildProcess);
        }
        catch (e) {
        }
    }

    if (weaveNextChildProcess == null) {
        weaveNextChildProcess = spawn(juliaExecutable, [path.join(extensionPath, 'scripts', 'weave', 'run_weave.jl')]);
    }
    weaveChildProcess = weaveNextChildProcess;

    weaveChildProcess.stdin.write(source_filename + '\n');
    weaveChildProcess.stdin.write(output_filename + '\n');
    if (selected_format===undefined) {
        weaveChildProcess.stdin.write('PREVIEW\n');
    }
    else {
        weaveChildProcess.stdin.write(selected_format + '\n');
    }

    weaveNextChildProcess = spawn(juliaExecutable, [path.join(extensionPath, 'scripts', 'weave', 'run_weave.jl')]);

    weaveChildProcess.stdout.on('data', function (data) {
        weaveOutputChannel.append(String(data));
    });
    weaveChildProcess.stderr.on('data', function (data) {
        weaveOutputChannel.append(String(data));
    });
    weaveChildProcess.on('close', async function (code) {
        weaveChildProcess = null;

        if (code == 0) {
            weaveOutputChannel.hide();

            if (selected_format===undefined) {
                lastWeaveContent = await fs.readFile(output_filename, "utf8")

                let uri = vscode.Uri.parse('jlweave://nothing.html');
                weaveProvider.update();
                let success = await vscode.commands.executeCommand('vscode.previewHtml', uri, column, "julia Weave Preview");
            }
        }
        else {
            vscode.window.showErrorMessage("Error during weaving.");
        }

    });
}

async function weave_open_preview_Command() {
    if (vscode.window.activeTextEditor === undefined) {
        vscode.window.showErrorMessage('Please open a document before you execute the weave command.');
    }
    else if (vscode.window.activeTextEditor.document.languageId!='juliamarkdown') {
        vscode.window.showErrorMessage('Only julia Markdown (.jmd) files can be weaved.');
    }
    else {
        weave_core(vscode.ViewColumn.One);
    }
}

async function weave_open_preview_side_Command() {
    if (vscode.window.activeTextEditor === undefined) {
        vscode.window.showErrorMessage('Please open a document before you execute the weave command.');
    }
    else if (vscode.window.activeTextEditor.document.languageId!='juliamarkdown') {
        vscode.window.showErrorMessage('Only julia Markdown (.jmd) files can be weaved.');
    }
    else {
        weave_core(vscode.ViewColumn.Two);
    }
}

async function weave_save_Command() {
    if (vscode.window.activeTextEditor === undefined) {
        vscode.window.showErrorMessage('Please open a document before you execute the weave command.');
    }
    else if (vscode.window.activeTextEditor.document.languageId!='juliamarkdown') {
        vscode.window.showErrorMessage('Only julia Markdown (.jmd) files can be weaved.');
    }
    else if (vscode.window.activeTextEditor.document.isDirty || vscode.window.activeTextEditor.document.isUntitled) {
        vscode.window.showErrorMessage('Please save the file before weaving.');
    }
    else {
        let formats = ['github: Github markdown',
            'md2tex: Julia markdown to latex',
            'pandoc2html: Markdown to HTML (requires Pandoc)',
            'pandoc: Pandoc markdown',
            'pandoc2pdf: Pandoc markdown',
            'tex: Latex with custom code environments',
            'texminted: Latex using minted for highlighting',
            'md2html: Julia markdown to html',
            'rst: reStructuredText and Sphinx',
            'multimarkdown: MultiMarkdown',
            'md2pdf: Julia markdown to latex',
            'asciidoc: AsciiDoc'];
        let result_format = await vscode.window.showQuickPick(formats, {placeHolder: 'Select output format'});
        if (result_format!=undefined) {
            let index = result_format.indexOf(':');
            let selected_format = result_format.substring(0,index);
            weave_core(vscode.ViewColumn.One, selected_format);
        }
    }
}

function startREPLconnectionServer() {
    let PIPE_PATH = generatePipeName(process.pid.toString(), 'vscode-language-julia-terminal');

    var server = net.createServer(function(stream) {
        let accumulatingBuffer = new Buffer(0);

        stream.on('data', function(c) {
            accumulatingBuffer = Buffer.concat([accumulatingBuffer, Buffer.from(c)]);
            let s = accumulatingBuffer.toString();
            let index_of_sep_1 = s.indexOf(":");
            let index_of_sep_2 = s.indexOf(";");

            if(index_of_sep_2>-1) {
                let mime_type = s.substring(0,index_of_sep_1);
                let msg_len_as_string = s.substring(index_of_sep_1+1,index_of_sep_2);
                let msg_len = parseInt(msg_len_as_string);
                if(accumulatingBuffer.length>=mime_type.length+msg_len_as_string.length+2+msg_len) {
                    let actual_image = s.substring(index_of_sep_2+1);
                    if(accumulatingBuffer.length > mime_type.length+msg_len_as_string.length+2+msg_len) {
                        accumulatingBuffer = Buffer.from(accumulatingBuffer.slice(mime_type.length+msg_len_as_string.length+2+msg_len + 1));
                    }
                    else {
                        accumulatingBuffer = new Buffer(0);
                    }

                    if(mime_type=='image/svg+xml') {
                        currentPlotIndex = plots.push(actual_image)-1;
                    }
                    else if(mime_type=='image/png') {
                        let plotPaneContent = '<html><img src="data:image/png;base64,' + actual_image + '" /></html>';
                        currentPlotIndex = plots.push(plotPaneContent)-1;
                    }
                    else {
                        throw new Error();
                    }
                    

                    let uri = vscode.Uri.parse('jlplotpane://nothing.html');
                    plotPaneProvider.update();
                    vscode.commands.executeCommand('vscode.previewHtml', uri, undefined, "julia Plot Pane");
                }
            }            
        });
    });

    server.on('close',function(){
        console.log('Server: on close');
    })

    server.listen(PIPE_PATH,function(){
        console.log('Server: on listening');
    })
}

function startREPLCommand() {
    startREPL();
    REPLterminal.show();
}

function startREPL() {
    if (REPLterminal==null) {
        let args = path.join(extensionPath, 'scripts', 'terminalserver', 'terminalserver.jl')
        REPLterminal = vscode.window.createTerminal("julia", juliaExecutable, ['-q', '-i', args, process.pid.toString()]);
    }
}

function generatePipeName(pid: string, name:string) {
    if (process.platform === 'win32') {
        return '\\\\.\\pipe\\' + name + '-' + pid;
    }
    else {
        return path.join(os.tmpdir(), name + '-' + pid);
    }
 }

function executeJuliaCodeInREPL() {
    var editor = vscode.window.activeTextEditor;
    if(!editor) {
        return;
    }
 
    var selection = editor.selection;
 
    var text = selection.isEmpty ? editor.document.lineAt(selection.start.line).text : editor.document.getText(selection);
 
     // If no text was selected, try to move the cursor to the end of the next line
    if (selection.isEmpty) {
        for (var line = selection.start.line+1; line < editor.document.lineCount; line++) {
            if (!editor.document.lineAt(line).isEmptyOrWhitespace) {
                var newPos = selection.active.with(line, editor.document.lineAt(line).range.end.character);
                var newSel = new vscode.Selection(newPos, newPos);
                editor.selection = newSel;
                break;
            }
        }
    }

    // This is the version that sends code to the REPL directly
    var lines = text.split(/\r?\n/);
    lines = lines.filter(line=>line!='');
    text = lines.join('\n');

    if(!text.endsWith("\n")) {
        text = text + '\n';
    }

    startREPL();
    REPLterminal.show(true);

    REPLterminal.sendText(text, false);

    // This is the version that has the julia process listen on a socket for code to be executed.
    // This is disabled for now, until we figure out how to hide the julia prompt.
    
    // var namedPipe = generatePipeName(process.pid.toString());

    // var onConnect = () => {
    //     var msg = {
    //         "command": "run",
    //         "body": text
    //     };
    //     client.write("Command: run\n");
    //     client.write(`Content-Length: ${text.length}\n`);
    //     client.write(`\n`);
    //     client.write(text);
    // };

    // var onError = (err) => {
    //     failCount += 1;
    //     if(failCount > 50) {
    //         vscode.window.showInformationMessage('Could not execute code.');
    //     }
    //     else {
    //         setTimeout(() => {
    //             client = net.connect(namedPipe, onConnect);
    //             client.on('error', onError);
    //         },100);
    //     }
    // };

    // var client = net.connect(namedPipe, onConnect);
    // var failCount = 0;

    // client.on('error', onError);
}


export function toggleLinter() {
    let cval = vscode.workspace.getConfiguration('julia').get('runlinter', false)
    vscode.workspace.getConfiguration('julia').update('runlinter', !cval, true)
}

export function applyTextEdit(we) {
    for (let edit of we.documentChanges[0].edits) {
        let wse = new vscode.WorkspaceEdit()
        wse.replace(we.documentChanges[0].textDocument.uri, new vscode.Range(edit.range.start.line, edit.range.start.character, edit.range.end.line, edit.range.end.character), edit.newText)
        vscode.workspace.applyEdit(wse)
    }
}

export function lintPackage() {
    try {
        languageClient.sendRequest("julia/lint-package");
    }
    catch(ex) {
        if(ex.message=="Language client is not ready yet") {
            vscode.window.showErrorMessage('Error: package linting only works with a running julia language server.');
        }
        else {
            throw ex;
        }
    }
}

export function reloadModules() {
    try {
        languageClient.sendRequest("julia/reload-modules");
    }
    catch(ex) {
        if(ex.message=="Language client is not ready yet") {
            vscode.window.showErrorMessage('Error: Language server is not yet running.');
        }
        else {
            throw ex;
        }
    }
}


function showPlotPane() {
    let uri = vscode.Uri.parse('jlplotpane://nothing.html');
    vscode.commands.executeCommand('vscode.previewHtml', uri, undefined, "julia Plot Pane");
}

function plotPanePrev() {
    if(currentPlotIndex>0) {
        currentPlotIndex = currentPlotIndex - 1;
        plotPaneProvider.update();
    }
}

function plotPaneNext() {
    if(currentPlotIndex<plots.length-1) {
        currentPlotIndex = currentPlotIndex + 1;
        plotPaneProvider.update();
    }
}

function plotPaneFirst() {
    if(plots.length>0) {
        currentPlotIndex = 0;
        plotPaneProvider.update();
    }
}

function plotPaneLast() {
    if(plots.length>0) {
        currentPlotIndex = plots.length - 1;
        plotPaneProvider.update();
    }
}

function plotPaneDel() {
    if(plots.length>0) {
        plots.splice(currentPlotIndex,1);
        if(currentPlotIndex>plots.length-1) {
            currentPlotIndex = plots.length - 1;
        }
        plotPaneProvider.update();
    }
}

async function getJuliaTasks(): Promise<vscode.Task[]> {
	let workspaceRoot = vscode.workspace.rootPath;

	let emptyTasks: vscode.Task[] = [];

	if (!workspaceRoot) {
		return emptyTasks;
	}

	try {
        const result: vscode.Task[] = [];

        if (await fs.exists(path.join(workspaceRoot, 'test', 'runtests.jl'))) {
            let testTask = new vscode.Task({ type: 'julia', command: 'test' }, `Run tests`, 'julia', new vscode.ProcessExecution(juliaExecutable, ['--color=yes', '-e', 'Pkg.test(Base.ARGS[1])', vscode.workspace.rootPath]), "");
            testTask.group = vscode.TaskGroup.Test;
            testTask.presentationOptions = { echo: false };
            result.push(testTask);
        }

        if (await fs.exists(path.join(workspaceRoot, 'deps', 'build.jl'))) {
            let splitted_path = vscode.workspace.rootPath.split(path.sep);
            let package_name = splitted_path[splitted_path.length-1];
            let buildTask = new vscode.Task({ type: 'julia', command: 'build'}, `Run build`, 'julia', new vscode.ProcessExecution(juliaExecutable, ['--color=yes', '-e', 'Pkg.build(Base.ARGS[1])', package_name]), "");
            buildTask.group = vscode.TaskGroup.Build;
            buildTask.presentationOptions = { echo: false };
            result.push(buildTask);
        }

        if (await fs.exists(path.join(workspaceRoot, 'benchmark', 'benchmarks.jl'))) {
            let splitted_path = vscode.workspace.rootPath.split(path.sep);
            let package_name = splitted_path[splitted_path.length-1];
            let benchmarkTask = new vscode.Task({ type: 'julia', command: 'benchmark'}, `Run benchmark`, 'julia', new vscode.ProcessExecution(juliaExecutable, ['--color=yes', '-e', 'using PkgBenchmark; benchmarkpkg(Base.ARGS[1], promptsave=false, promptoverwrite=false)', package_name]), "");
            benchmarkTask.presentationOptions = { echo: false };
            result.push(benchmarkTask);
        }

        if (await fs.exists(path.join(workspaceRoot, 'docs', 'make.jl'))) {
            let buildTask = new vscode.Task({ type: 'julia', command: 'docbuild'}, `Build documentation`, 'julia', new vscode.ProcessExecution(juliaExecutable, ['--color=yes', '-e', 'include(Base.ARGS[1])', path.join(workspaceRoot, 'docs', 'make.jl')]), "");
            buildTask.group = vscode.TaskGroup.Build;
            buildTask.presentationOptions = { echo: false };
            result.push(buildTask);
        }

		return Promise.resolve(result);
	} catch (e) {
		return Promise.resolve(emptyTasks);
	}
}

function sendMessageToREPL(msg: string) {
    let sock = generatePipeName(process.pid.toString(), 'vscode-language-julia-torepl')

    let conn = net.connect(sock)

    conn.write(msg + "\n")
    conn.on('error', () => {vscode.window.showErrorMessage("REPL open")})
}

function startREPLConn() {
    let PIPE_PATH = generatePipeName(process.pid.toString(), 'vscode-language-julia-fromrepl');

    var server = net.createServer(function(stream) {
        let accumulatingBuffer = new Buffer(0);

        stream.on('data', async function(c) {
            accumulatingBuffer = Buffer.concat([accumulatingBuffer, Buffer.from(c)]);
            let availableMods = accumulatingBuffer.toString().split(",")
            let result = await vscode.window.showQuickPick(availableMods, {placeHolder: 'Switch to Module...'})
            if (result!=undefined) {
                sendMessageToREPL('repl/changeModule: ' + result)
            }
        });
    });

    server.on('close',function(){
        console.log('Server: on close');
    })

    server.listen(PIPE_PATH, function(){
        console.log('Server: on listening');
    })
}
