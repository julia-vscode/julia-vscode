'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs'
import * as path from 'path'
import * as net from 'net';
import JuliaValidationProvider from './linter';
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TransportKind, StreamInfo } from 'vscode-languageclient';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Activating extension language-julia');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand('language-julia.openPackageDirectory', openPackageDirectoryCommand);

    context.subscriptions.push(disposable);

    let connectFunc = () => {
            return new Promise<StreamInfo>(
                (resolve, reject) => {
                    var socket = net.connect(7458);
                    socket.on(
                        'connect',
                        function() {
                            console.log("Socket connected!");
                            resolve({writer: socket, reader: socket})
                        });
                });
        };

    let clientOptions: LanguageClientOptions = {
		// Register the server for plain text documents
		documentSelector: ['julia']
		// synchronize: {
		// 	// Synchronize the setting section 'languageServerExample' to the server
		// 	configurationSection: 'languageServerExample',
		// 	// Notify the server about file changes to '.clientrc files contain in the workspace
		// 	fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
		// }
	}

    // Create the language client and start the client.
	let languageClient = new LanguageClient('julia Language Server',connectFunc,clientOptions).start();
	
	// Push the disposable to the context's subscriptions so that the 
	// client can be deactivated on extension deactivation
	context.subscriptions.push(languageClient);

    // let validator = new JuliaValidationProvider();
	// validator.activate(context);
}

// this method is called when your extension is deactivated
export function deactivate() {
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
