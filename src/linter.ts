'use strict';
import * as vscode from 'vscode';
import * as fs from 'fs'
import * as path from 'path'
import * as net from 'net';
import * as readline from 'readline';
import cp = require('child_process');
import { ThrottledDelayer } from './async';
import * as os from 'os';
var carrier = require('carrier');
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TransportKind, StreamInfo } from 'vscode-languageclient';

function generatePipeName(pid: string) {
    if (process.platform === 'win32') {
        return '\\\\.\\pipe\\vscode-language-julia-lint-server-socket-' + pid;
    }
    else {
        return path.join(os.tmpdir(), 'vscode-language-julia-lint-server-socket-' + pid);
    }
}

export default class JuliaValidationProvider {
    private validationEnabled: boolean;
    private executable: string;

    private juliaLinterProcess: cp.ChildProcess;
    private juliaLanguageClient: LanguageClient;
    private extensionPath: string;

    private context: vscode.ExtensionContext;

    constructor() {
        this.executable = null;
        this.validationEnabled = true;
        this.juliaLinterProcess = null;
        this.extensionPath = null;
    }

    public activate(context: vscode.ExtensionContext) {
        this.context = context;
        var subscriptions = context.subscriptions;
        this.extensionPath = context.extensionPath;
        subscriptions.push(this);
        vscode.workspace.onDidChangeConfiguration(this.loadConfiguration, this, subscriptions);
        this.loadConfiguration();
    }

    public dispose(): void {
    }

    private findAndStartJulia() {
        if (this.executable !== null) {
            this.startLintProcess(this.executable);
        }
        else {
            this.startLintProcess('julia');
        }
    }

    private startLintProcess(juliaExecPath: string) {
        let spawnOptions = {
            cwd: path.join(this.extensionPath, 'scripts', 'languageserver'),
            env: {
                JULIA_PKGDIR: path.join(this.extensionPath, 'scripts', 'languageserver', 'julia_pkgdir'),
                HOME: process.env.HOME ? process.env.HOME : os.homedir()
            }
        };
        var originalJuliaPkgDir = process.env.JULIA_PKGDIR ? process.env.JULIA_PKGDIR : path.join(os.homedir(), '.julia', 'v0.5');

        this.juliaLinterProcess = cp.spawn(juliaExecPath, ['--startup-file=no', '--history-file=no', 'languageserver.jl', generatePipeName(process.pid.toString()), originalJuliaPkgDir], spawnOptions);

        this.juliaLinterProcess.on('exit', () => {
            this.juliaLinterProcess = null;
        });

        this.juliaLinterProcess.on('error', err => {
            this.juliaLinterProcess = null;
            vscode.window.showErrorMessage('Could not start julia for linter process.');
        });

        let connectFunc = () => {
            return new Promise<StreamInfo>(
                (resolve, reject) => {
                    var socket = net.connect(generatePipeName(process.pid.toString()));
                    socket.on(
                        'connect',
                        function () {
                            console.log("Socket connected!");
                            resolve({ writer: socket, reader: socket })
                        });
                });
        };

        let jlp_out_lr = readline.createInterface(this.juliaLinterProcess.stdout, this.juliaLinterProcess.stdin);
        jlp_out_lr.on('line', data => {
            console.log('jl linter: server output: ' + data);
            if (data == 'julia language server running on ' + generatePipeName(process.pid.toString())) {
                let clientOptions: LanguageClientOptions = {
                    // Register the server for plain text documents
                    documentSelector: ['julia']
                }

                // Create the language client and start the client.
                this.juliaLanguageClient = new LanguageClient('julia Language Server', connectFunc, clientOptions);
                let asdf = this.juliaLanguageClient.start();

                // Push the disposable to the context's subscriptions so that the 
                // client can be deactivated on extension deactivation
                this.context.subscriptions.push(asdf);
            }
            else if (data == 'VS Code linter only works with julia 0.5') {
                vscode.window.showErrorMessage('julia linter only works with julia 0.5.');
            }
        });

        let jlp_err_lr = readline.createInterface(this.juliaLinterProcess.stderr, this.juliaLinterProcess.stdin);
        jlp_err_lr.on('line', function (data) {
            console.log('jl linter: server output: ' + data);
        });
    }

    private loadConfiguration(): void {
        let section = vscode.workspace.getConfiguration('julia');

        if (section) {
            this.validationEnabled = section.get<boolean>('validate.enable', true);
            this.executable = section.get<string>('validate.executablePath', null);
        }

        if (this.validationEnabled) {
            if (this.juliaLinterProcess !== null) {
                this.juliaLinterProcess.on('exit', () => {
                    this.juliaLinterProcess = null;
                    if (this.validationEnabled) {
                        this.findAndStartJulia();
                    }
                });
                this.juliaLinterProcess.kill();
            }
            else {
                this.findAndStartJulia();
            }

        }

    }
}
