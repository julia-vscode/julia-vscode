'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs'
import * as path from 'path'
import * as net from 'net';
import * as os from 'os';
var exec = require('child-process-promise').exec;
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TransportKind, StreamInfo } from 'vscode-languageclient';

let juliaExecutable = null;
let languageClient = null;
let REPLterminal: vscode.Terminal = null;
let extensionPath: string = null;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    extensionPath = context.extensionPath;
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Activating extension language-julia');

    loadConfiguration();

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable_OpenPkgCommand = vscode.commands.registerCommand('language-julia.openPackageDirectory', openPackageDirectoryCommand);
    context.subscriptions.push(disposable_OpenPkgCommand);

    let disposable_StartREPLCommand = vscode.commands.registerCommand('language-julia.startREPL', startREPLCommand);
    context.subscriptions.push(disposable_StartREPLCommand);

    let disposable_executeJuliaCodeInREPL = vscode.commands.registerCommand('language-julia.executeJuliaCodeInREPL', executeJuliaCodeInREPL);
    context.subscriptions.push(disposable_executeJuliaCodeInREPL);

    vscode.window.onDidCloseTerminal(terminal=>{
        if (terminal==REPLterminal) {
            REPLterminal = null;
        }
    })
    vscode.languages.setLanguageConfiguration('julia', {
        onEnterRules: [
            {
                beforeText: /^\s*(?:abstract|type|bitstype|immutable|function|macro|for|if|elseif|else|while|try|with|finally|catch|except|async|let|do).*\s*$/,
                action: { indentAction: vscode.IndentAction.Indent}
            }
        ]

    });
    startLanguageServer(context);
}

// this method is called when your extension is deactivated
export function deactivate() {
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

    return juliaExecutable != oldValue
}

async function getPkgPath() {
    var res = await exec(`${juliaExecutable} -e "println(Pkg.dir())"`);
    return res.stdout;
}

async function startLanguageServer(context: vscode.ExtensionContext) {
    // let debugOptions = { execArgv: ["--nolazy", "--debug=6004"] };

    var originalJuliaPkgDir = await getPkgPath();
    let serverArgs = ['--startup-file=no', '--history-file=no', 'main.jl', originalJuliaPkgDir];
    let spawnOptions = {
        cwd: path.join(context.extensionPath, 'scripts', 'languageserver'),
        env: {
            JULIA_PKGDIR: path.join(context.extensionPath, 'scripts', 'languageserver', 'julia_pkgdir'),
            HOME: process.env.HOME ? process.env.HOME : os.homedir()
        }
    };

    let serverOptions = {
        run: { command: juliaExecutable, args: serverArgs, options: spawnOptions },
        debug: { command: juliaExecutable, args: serverArgs, options: spawnOptions }
    };

    let clientOptions: LanguageClientOptions = {
        // Register the server for plain text documents
        documentSelector: ['julia']
    }

    // Create the language client and start the client.
    languageClient = new LanguageClient('julia Language Server', serverOptions, clientOptions);

    // Push the disposable to the context's subscriptions so that the 
    // client can be deactivated on extension deactivation
    try {
        context.subscriptions.push(languageClient.start());
    }
    catch (e) {
        console.log("Couldn't start it.");
        languageClient = null;
    }
}

// This method implements the language-julia.openPackageDirectory command
function openPackageDirectoryCommand() {
    const optionsVersion: vscode.QuickPickOptions = {
        placeHolder: 'Select julia version'
    };
    const optionsPackage: vscode.QuickPickOptions = {
        placeHolder: 'Select package'
    };

    var homeDirectory = process.env[process.platform == 'win32' ? 'USERPROFILE' : 'HOME'];
    var juliaHomeDirectory = process.env['JULIA_HOME'] || path.join(homeDirectory, '.julia')

    fs.exists(juliaHomeDirectory,
        exists => {
            if (!exists) {
                vscode.window.showInformationMessage('Error: Could not find julia home directory.');
            }
            else {
                fs.readdir(juliaHomeDirectory,
                    (err, files) => {
                        if (err) {
                            vscode.window.showInformationMessage('Error: Could not read julia home directory.');
                        }
                        else {
                            var r = /^v\d*\.\d*$/;
                            var filteredFiles = files.filter(path => path.search(r) > -1).map(path => path.substr(1));

                            if (filteredFiles.length == 0) {
                                vscode.window.showInformationMessage('Error: There are no packages installed.');
                            }
                            else {
                                vscode.window.showQuickPick(filteredFiles, optionsVersion)
                                    .then(resultVersion => {
                                        if (resultVersion !== undefined) {
                                            var juliaVersionHomeDir = path.join(juliaHomeDirectory, 'v' + resultVersion);
                                            fs.readdir(juliaVersionHomeDir,
                                                (err, files) => {
                                                    if (err) {
                                                        vscode.window.showInformationMessage('Error: Could not read package directory.');
                                                    }
                                                    else {
                                                        var filteredPackages = files.filter(path => !path.startsWith('.') && ['METADATA', 'REQUIRE', 'META_BRANCH'].indexOf(path) < 0);
                                                        vscode.window.showQuickPick(filteredPackages, optionsPackage)
                                                            .then(resultPackage => {
                                                                if (resultPackage !== undefined) {
                                                                    var folder = vscode.Uri.file(path.join(juliaVersionHomeDir, resultPackage));
                                                                    vscode.commands.executeCommand('vscode.openFolder', folder, true)
                                                                        .then(
                                                                        value => ({}),
                                                                        value => {
                                                                            vscode.window.showInformationMessage('Could not open the package.');
                                                                        });
                                                                }
                                                            });
                                                    }
                                                });
                                        }
                                    })
                            }
                        }
                    })
            }
        });
}

function startREPLCommand() {
    
    if (REPLterminal==null) {
        let args = path.join(extensionPath, 'scripts', 'terminalserver', 'terminalserver.jl')
        REPLterminal = vscode.window.createTerminal("julia", juliaExecutable, ['-q', '-i', args, process.pid.toString()]);
    }
    REPLterminal.show();
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

    startREPLCommand();

    var namedPipe = generatePipeName(process.pid.toString());

    var onConnect = () => {
        var msg = {
            "command": "run",
            "body": text
        };
        client.write("Command: run\n");
        client.write(`Content-Length: ${text.length}\n`);
        client.write(`\n`);
        client.write(text);
    };

    var onError = (err) => {
        failCount += 1;
        if(failCount > 50) {
            vscode.window.showInformationMessage('Could not execute code.');
        }
        else {
            setTimeout(() => {
                client = net.connect(namedPipe, onConnect);
                client.on('error', onError);
            },100);
        }
    };

    var client = net.connect(namedPipe, onConnect);
    var failCount = 0;

    client.on('error', onError);
}
