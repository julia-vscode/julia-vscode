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

let juliaExecutable = null;
let juliaPackagePath: string = null;
let languageClient: LanguageClient = null;
let REPLterminal: vscode.Terminal = null;
let extensionPath: string = null;
let g_context: vscode.ExtensionContext = null;
let testOutputChannel: vscode.OutputChannel = null;
let testChildProcess: ChildProcess = null;
let testStatusBarItem: vscode.StatusBarItem = null;
let lastWeaveContent: string = null;
let weaveOutputChannel: vscode.OutputChannel = null;
let weaveChildProcess: ChildProcess = null;
let weaveNextChildProcess: ChildProcess = null;

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
    

    weaveProvider = new WeaveDocumentContentProvider();
    let disposable_weaveProvider = vscode.workspace.registerTextDocumentContentProvider('jlweave', weaveProvider);
    context.subscriptions.push(disposable_weaveProvider);

    let disposable_executeJuliaCodeInREPL = vscode.commands.registerCommand('language-julia.executeJuliaCodeInREPL', executeJuliaCodeInREPL);
    context.subscriptions.push(disposable_executeJuliaCodeInREPL);

    let disposable_runTests = vscode.commands.registerCommand('language-julia.runTests', runTests);
    context.subscriptions.push(disposable_runTests);

    let disposable_toggleLinter = vscode.commands.registerCommand('language-julia.toggleLinter', toggleLinter);
    context.subscriptions.push(disposable_toggleLinter);

    testStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    testStatusBarItem.tooltip = 'Interrupt test run.';
    testStatusBarItem.text = '$(beaker) julia tests are running...';
    testStatusBarItem.command = 'language-julia.cancelTests';

    let disposable_cancelTests = vscode.commands.registerCommand('language-julia.cancelTests', cancelTests);
    context.subscriptions.push(disposable_cancelTests);

    vscode.window.onDidCloseTerminal(terminal=>{
        if (terminal==REPLterminal) {
            REPLterminal = null;
        }
    })
    vscode.languages.setLanguageConfiguration('julia', {
        indentationRules: {
            increaseIndentPattern: /^(\s*|.*=\s*|.*@\w*\s*)[\w\s]*(if|while|for|function|macro|immutable|struct|type|let|quote|try|begin|.*\)\s*do|else|elseif|catch|finally)\b(?!.*\bend\b[^\]]*$).*$/,
            decreaseIndentPattern: /^\s*(end|else|elseif|catch|finally)\b.*$/
        }
    });
    startLanguageServer();
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

        await fs.writeFile(source_filename, vscode.window.activeTextEditor.document.getText(), 'utf-8');
    
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
                lastWeaveContent = await fs.readFile(output_filename, "utf-8")

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

async function runTests() {
    if (vscode.workspace.rootPath === undefined) {
        vscode.window.showInformationMessage('julia tests can only be run if a folder is opened.');
    }
    else {
        if (testOutputChannel == null) {
            testOutputChannel = vscode.window.createOutputChannel("julia tests");
        }
        testOutputChannel.clear();
        testOutputChannel.show(true);

        if (testChildProcess != null) {
            try {
                await kill(testChildProcess);
            }
            catch (e) {
            }
        }

        testStatusBarItem.show();
        testChildProcess = spawn(juliaExecutable, ['-e', 'Pkg.Entry.test(AbstractString[Base.ARGS[1]])', vscode.workspace.rootPath], { cwd: vscode.workspace.rootPath });
        testChildProcess.stdout.on('data', function (data) {
            testOutputChannel.append(String(data));
        });
        testChildProcess.stderr.on('data', function (data) {
            testOutputChannel.append(String(data));
        });
        testChildProcess.on('close', function (code) {
            testChildProcess = null;
            testStatusBarItem.hide();
        });
    }
}

async function cancelTests() {
    if(testChildProcess==null) {
        await vscode.window.showInformationMessage('No julia tests are running.')
    }
    else {
        testChildProcess.kill();
    }
}

function startREPLCommand() {
    startREPL();
    REPLterminal.show();
}

function startREPL() {
    if (REPLterminal==null) {
        let args = path.join(extensionPath, 'scripts', 'terminalserver', 'terminalserver.jl')
        // REPLterminal = vscode.window.createTerminal("julia", juliaExecutable, ['-q', '-i', args, process.pid.toString()]);
        REPLterminal = vscode.window.createTerminal("julia", juliaExecutable, ['-q', '-i']);
    }
}

function generatePipeName(pid: string) {
    if (process.platform === 'win32') {
        return '\\\\.\\pipe\\vscode-language-julia-terminal-' + pid;
    }
    else {
        return path.join(os.tmpdir(), 'vscode-language-julia-terminal-' + pid);
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
    languageClient.sendRequest("julia/lint-package")
}
