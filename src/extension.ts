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
import * as vslc from 'vscode-languageclient';
import * as rpc from 'vscode-jsonrpc';
import { REPLHandler, PlotPaneDocumentContentProvider } from './repl'
import { WeaveDocumentContentProvider } from './weave'

let juliaExecutable = null;
let juliaPackagePath: string = null;
let languageClient: LanguageClient = null;
let extensionPath: string = null;
let g_context: vscode.ExtensionContext = null;
let serverstatus: vscode.StatusBarItem = null;
let serverBusyNotification = new rpc.NotificationType<string, void>('window/setStatusBusy');
let serverReadyNotification = new rpc.NotificationType<string, void>('window/setStatusReady');
let taskProvider: vscode.Disposable | undefined;

export interface TextDocumentPositionParams {
    textDocument: vslc.TextDocumentIdentifier
    position: vscode.Position
}

let getBlockText = new rpc.RequestType<TextDocumentPositionParams, void,void,void>('julia/getCurrentBlockText')

export function activate(context: vscode.ExtensionContext) {
    g_context = context;
    extensionPath = context.extensionPath;
    console.log('Activating extension language-julia');

    loadConfiguration();
    
    // REPL
    // const replTree = new REPLTree(context);
    let repl = new REPLHandler(extensionPath, juliaExecutable)
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('jlplotpane', repl.plotPaneProvider));
    vscode.window.registerTreeDataProvider('REPLVariables', repl);
    
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.startREPL', () => {repl.startREPL()}));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.executeJuliaCodeInREPL', () => {repl.executeSelection()}));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.executeJuliaFileInREPL', () => {repl.executeFile()}));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.change-repl-module', () => {
        repl.sendMessage('repl/getAvailableModules', '')
        vscode.window.showTextDocument(vscode.window.activeTextEditor.document)
    }));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.executeJuliaBlockInREPL', () => {
        var editor = vscode.window.activeTextEditor;
        let params : TextDocumentPositionParams = {textDocument: vslc.TextDocumentIdentifier.create(editor.document.uri.toString()), position: new vscode.Position(editor.selection.start.line, editor.selection.start.character)}
        languageClient.sendRequest('julia/getCurrentBlockText', params).then((text)=>{
            repl.executeCode(text)
            vscode.window.showTextDocument(vscode.window.activeTextEditor.document)
        })
    }));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.show-plotpane', repl.plotPaneProvider.showPlotPane));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.plotpane-previous', repl.plotPaneProvider.plotPanePrev));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.plotpane-next', repl.plotPaneProvider.plotPaneNext));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.plotpane-first', repl.plotPaneProvider.plotPaneFirst));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.plotpane-last', repl.plotPaneProvider.plotPaneLast));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.plotpane-delete', repl.plotPaneProvider.plotPaneDel));


    // Status bar
    serverstatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);   
    serverstatus.show()
    serverstatus.text = 'Julia: starting up';
    context.subscriptions.push(serverstatus);


    // Weave
    let weaveProvider = new WeaveDocumentContentProvider(extensionPath, juliaExecutable);
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('jlweave', weaveProvider));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.weave-open-preview', ()=>{weaveProvider.open_preview()}));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.weave-open-preview-side', ()=>{weaveProvider.open_preview_side}));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.weave-save', ()=>{weaveProvider.save}));


    // Misc. commands
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(configChanged));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.openPackageDirectory', openPackageDirectoryCommand));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.applytextedit', applyTextEdit));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.lint-package', lintPackage));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.toggleLinter', toggleLinter));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.reload-modules', reloadModules));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.toggle-log', toggleServerLogs));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.toggle-file-lint', (arg) => {
        try {
            languageClient.sendRequest("julia/toggleFileLint", arg);
        }
        catch(ex) {5
            if(ex.message=="Language client is not ready yet") {
                vscode.window.showErrorMessage('Error: server is not running.');
            }
            else {
                throw ex;
            }
        }

    }));

    vscode.window.onDidCloseTerminal(terminal=>{
        if (terminal==repl.terminal) {
            repl.terminal = null;
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
        documentSelector: ['julia', 'juliamarkdown'],
        synchronize: {
            configurationSection: ['julia.runlinter', 'julia.lintIgnoreList'],
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
        languageClient.onNotification(serverBusyNotification, ()=>{serverstatus.text = 'Julia: busy'})
        languageClient.onNotification(serverReadyNotification, ()=>{serverstatus.text = 'Julia: ready'})
    })
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

export function toggleLinter() {
    let cval = vscode.workspace.getConfiguration('julia').get('runlinter', false)
    vscode.workspace.getConfiguration('julia').update('runlinter', !cval, true)
}

export function applyTextEdit(we) {
    let wse = new vscode.WorkspaceEdit()
    for (let edit of we.documentChanges[0].edits) {
        wse.replace(we.documentChanges[0].textDocument.uri, new vscode.Range(edit.range.start.line, edit.range.start.character, edit.range.end.line, edit.range.end.character), edit.newText)
    }
    vscode.workspace.applyEdit(wse)
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

export function toggleServerLogs() {
    try {
        languageClient.sendRequest("julia/toggle-log");
    }
    catch(ex) {
        if(ex.message=="Language client is not ready yet") {
            vscode.window.showErrorMessage('Error: server is not running.');
        }
        else {
            throw ex;
        }
    }
}
