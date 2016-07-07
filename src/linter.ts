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

enum RunTrigger {
    onSave,
    onType
}

namespace RunTrigger {
    export let strings = {
        onSave: 'onSave',
        onType: 'onType'
    };
    export let from = function (value: string): RunTrigger {
        if (value === 'onType') {
            return RunTrigger.onType;
        } else {
            return RunTrigger.onSave;
        }
    };
}

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
    private trigger: RunTrigger;

    private documentListener: vscode.Disposable;
    private diagnosticCollection: vscode.DiagnosticCollection;
    private delayers: { [key: string]: ThrottledDelayer<void> };

    private juliaLinterProcess: cp.ChildProcess;
    private extensionPath: string;

    constructor() {
        this.executable = null;
        this.validationEnabled = true;
        this.trigger = RunTrigger.onType;
        this.juliaLinterProcess = null;
        this.extensionPath = null;
    }

    public activate(context: vscode.ExtensionContext) {
        var subscriptions = context.subscriptions;
        this.extensionPath = context.extensionPath;
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('julia');
        subscriptions.push(this);
        vscode.workspace.onDidChangeConfiguration(this.loadConfiguration, this, subscriptions);
        this.loadConfiguration();

        vscode.workspace.onDidOpenTextDocument(this.triggerValidate, this, subscriptions);
        vscode.workspace.onDidCloseTextDocument((textDocument) => {
            this.diagnosticCollection.delete(textDocument.uri);
            delete this.delayers[textDocument.uri.toString()];
        }, null, subscriptions);
    }

    public dispose(): void {
        this.diagnosticCollection.clear();
        this.diagnosticCollection.dispose();
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
            cwd: path.join(this.extensionPath, 'scripts', 'lintserver'),
            env: {
                JULIA_PKGDIR: path.join(this.extensionPath, 'scripts', 'lintserver', 'julia_pkgdir'),
                HOME: process.env.HOME ? process.env.HOME : os.homedir() }
        };
        var originalJuliaPkgDir = process.env.JULIA_PKGDIR ? process.env.JULIA_PKGDIR : path.join(os.homedir(), '.julia', 'v0.4');
        
        this.juliaLinterProcess = cp.spawn(juliaExecPath, ['--startup-file=no', '--history-file=no', 'lintserver.jl', generatePipeName(process.pid.toString()), originalJuliaPkgDir], spawnOptions);

        this.juliaLinterProcess.on('exit', () => {
            this.juliaLinterProcess = null;
        });

        this.juliaLinterProcess.on('error', err => {
            this.juliaLinterProcess = null;
            vscode.window.showErrorMessage('Could not start julia.exe for linter process.');
        });

        let jlp_out_lr = readline.createInterface(this.juliaLinterProcess.stdout, this.juliaLinterProcess.stdin);
        jlp_out_lr.on('line', data => {
            console.log('jl linter: server output: ' + data);
            if (data == 'Server running on port ' + generatePipeName(process.pid.toString()) + ' ...') {
                // Configuration has changed. Reevaluate all documents.
                vscode.workspace.textDocuments.forEach(this.triggerValidate, this);
            }
            else if (data == 'VS Code linter only works with julia 0.4') {
                vscode.window.showErrorMessage('julia linter only works with julia 0.4.');
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
            this.trigger = RunTrigger.from(section.get<string>('validate.run', RunTrigger.strings.onType));
        }

        this.delayers = Object.create(null);
        if (this.documentListener) {
            this.documentListener.dispose();
        }
        this.diagnosticCollection.clear();

        if (this.validationEnabled) {
            if (this.trigger === RunTrigger.onType) {
                this.documentListener = vscode.workspace.onDidChangeTextDocument((e) => {
                    this.triggerValidate(e.document);
                });
            } else {
                this.documentListener = vscode.workspace.onDidSaveTextDocument(this.triggerValidate, this);
            }
        }

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
            if (this.validationEnabled) {
                this.findAndStartJulia();
            }
        }
    }

    private triggerValidate(textDocument: vscode.TextDocument): void {
        if (textDocument.languageId !== 'julia' || this.juliaLinterProcess === null || !this.validationEnabled) {
            return;
        }
        let key = textDocument.uri.toString();
        let delayer = this.delayers[key];
        if (!delayer) {
            delayer = new ThrottledDelayer<void>(this.trigger === RunTrigger.onType ? 250 : 0);
            this.delayers[key] = delayer;
        }
        delayer.trigger(() => this.doValidate(textDocument));
    }

    private mapSeverityToVSCodeSeverity(sev: string): vscode.DiagnosticSeverity {
        switch (sev.substring(0, 1)) {
            case "E": return vscode.DiagnosticSeverity.Error;
            case "W": return vscode.DiagnosticSeverity.Warning;
            case "I": return vscode.DiagnosticSeverity.Information;
            default: return vscode.DiagnosticSeverity.Error;
        }
    }

    private doValidate(textDocument: vscode.TextDocument): Promise<void> {
        var filename = textDocument.fileName;

        return new Promise<void>((resolve, reject) => {
            let diagnostics: vscode.Diagnostic[] = [];
            let processLine = (line: string) => {
                var colon_sep = line.indexOf(':', filename.length);
                var space1_sep = line.indexOf(' ', colon_sep + 1);
                var linenumber_str = line.substring(colon_sep + 1, space1_sep);
                var linenumber = parseInt(linenumber_str) - 1;
                var space2_sep = line.indexOf(' ', space1_sep + 1);
                var errornumber = line.substring(space1_sep + 1, space2_sep);
                var errormsg = line.substring(space2_sep + 1);

                let range = new vscode.Range(linenumber, 0, linenumber, Number.MAX_VALUE);
                let diagnostic = new vscode.Diagnostic(range, errormsg, this.mapSeverityToVSCodeSeverity(errornumber));
                diagnostics.push(diagnostic);
            };

            try {
                var client = net.connect(generatePipeName(process.pid.toString()), () => {
                    console.log('jl linter: connected to lint server');
                    var msg1 = filename + '\n';
                    var msg3 = textDocument.getText();
                    var msg2 = msg3.length.toString() + '\n';
                    client.write(msg1 + msg2 + msg3);
                });

                client.on('error', err => {
                    console.log('jl linter: could not connect to lint server');
                    resolve();
                });

                carrier.carry(client, msg => {
                    var lines = msg.split(/\r?\n/);

                    lines.forEach(processLine);

                    this.diagnosticCollection.set(textDocument.uri, diagnostics);

                    console.log('jl linter: finished linting.');

                    resolve();
                }, 'utf8', /\r?\n\r?\n/);
            }
            catch (error) {
                console.log('jl linter: unknown error.');
            }
        });
    }
}
