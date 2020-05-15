'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'async-file';
import * as path from 'path'
import * as net from 'net';
import * as os from 'os';
import * as telemetry from './telemetry';
import { spawn, ChildProcess } from 'child_process';
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions, TransportKind, StreamInfo, RevealOutputChannelOn } from 'vscode-languageclient';
import * as vslc from 'vscode-languageclient';
import * as rpc from 'vscode-jsonrpc';
import * as repl from './repl';
import * as weave from './weave';
import * as tasks from './tasks';
import * as settings from './settings';
import * as smallcommands from './smallcommands';
import * as packagepath from './packagepath';
import * as openpackagedirectory from './openpackagedirectory';
import * as juliaexepath from './juliaexepath';
import * as jlpkgenv from './jlpkgenv';
import { JuliaDebugSession } from './juliaDebug';

let g_settings: settings.ISettings = null;
let g_languageClient: LanguageClient = null;
let g_context: vscode.ExtensionContext = null;

let g_serverFullTextNotification = new rpc.NotificationType<string, string>('julia/getFullText');

export async function activate(context: vscode.ExtensionContext) {
    await telemetry.init(context);

    telemetry.traceEvent('activate');

    telemetry.startLsCrashServer();

    g_context = context;

    console.log('Activating extension language-julia');

    g_settings = settings.loadSettings();

    // Config change
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(configChanged));

    // Language settings
    vscode.languages.setLanguageConfiguration('julia', {
        indentationRules: {
            increaseIndentPattern: /^(\s*|.*=\s*|.*@\w*\s*)[\w\s]*\b(if|while|for|function|macro|immutable|struct|type|let|quote|try|begin|.*\)\s*do|else|elseif|catch|finally)\b(?!.*\bend\b[^\]]*$).*$/,
            decreaseIndentPattern: /^\s*(end|else|elseif|catch|finally)\b.*$/
        }
    });

    // Active features from other files
    juliaexepath.activate(context, g_settings);
    await juliaexepath.getJuliaExePath(); // We run this function now and await to make sure we don't run in twice simultaneously later
    repl.activate(context, g_settings);
    weave.activate(context, g_settings);
    tasks.activate(context, g_settings);
    smallcommands.activate(context, g_settings);
    packagepath.activate(context, g_settings);
    openpackagedirectory.activate(context, g_settings);
    jlpkgenv.activate(context, g_settings);
    
    vscode.window.onDidChangeTextEditorSelection(e=>{
        repl.decorateSelection()
    })
    // register a configuration provider for 'mock' debug type
    const provider = new JuliaDebugConfigurationProvider();
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('julia', provider));

    let factory = new InlineDebugAdapterFactory();
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('julia', factory));

    vscode.commands.registerCommand('language-julia.debug.getActiveJuliaEnvironment', async config => {
        let pkgenvpath = await jlpkgenv.getEnvPath();
        return pkgenvpath;
    });

    // Start language server
    startLanguageServer();

    if (vscode.workspace.getConfiguration('julia').get<boolean>('enableTelemetry') === null) {
        vscode.window.showInformationMessage("To help improve the Julia extension, you can allow the development team to collect usage data. Read our [privacy statement](https://github.com/julia-vscode/julia-vscode/wiki/Privacy-Policy) to learn more how we use usage data and how to permanently hide this notification.", 'I agree to usage data collection')
            .then(telemetry_choice => {
                if (telemetry_choice == "I agree to usage data collection") {
                    vscode.workspace.getConfiguration('julia').update('enableTelemetry', true, true);
                }
            });
    }
}

// this method is called when your extension is deactivated
export function deactivate() {
}

function setLanguageClient(languageClient: vslc.LanguageClient) {
    g_languageClient = languageClient;

    juliaexepath.onNewLanguageClient(g_languageClient);
    repl.onNewLanguageClient(g_languageClient);
    weave.onNewLanguageClient(g_languageClient);
    tasks.onNewLanguageClient(g_languageClient);
    smallcommands.onNewLanguageClient(g_languageClient);
    packagepath.onNewLanguageClient(g_languageClient);
    openpackagedirectory.onNewLanguageClient(g_languageClient);
    jlpkgenv.onNewLanguageClient(g_languageClient);
}

function configChanged(params) {
    let newSettings = settings.loadSettings();

    telemetry.onDidChangeConfiguration(newSettings);
    juliaexepath.onDidChangeConfiguration(newSettings);
    repl.onDidChangeConfiguration(newSettings);
    weave.onDidChangeConfiguration(newSettings);
    tasks.onDidChangeConfiguration(newSettings);
    smallcommands.onDidChangeConfiguration(newSettings);
    packagepath.onDidChangeConfiguration(newSettings);
    openpackagedirectory.onDidChangeConfiguration(newSettings);
    jlpkgenv.onDidChangeConfiguration(newSettings);

    let need_to_restart_server = false;

    if (g_settings.juliaExePath != newSettings.juliaExePath) {
        need_to_restart_server = true;
    }

    if (need_to_restart_server) {
        if (g_languageClient != null) {
            g_languageClient.stop();
            setLanguageClient(null);
        }

        startLanguageServer();
    }
}

async function startLanguageServer() {
    // let debugOptions = { execArgv: ["--nolazy", "--debug=6004"] };

    let jlEnvPath = '';
    try {
        jlEnvPath = await jlpkgenv.getEnvPath();
    }
    catch (e) {

        vscode.window.showErrorMessage('Could not start the julia language server. Make sure the configuration setting julia.executablePath points to the julia binary.');
        vscode.window.showErrorMessage(e)
        return;
    }
    let oldDepotPath = process.env.JULIA_DEPOT_PATH ? process.env.JULIA_DEPOT_PATH : "";
    let envForLSPath = path.join(g_context.extensionPath, "scripts", "languageserver", "packages")
    let serverArgsRun = ['--startup-file=no', '--history-file=no', '--depwarn=no', `--project=${envForLSPath}`, 'main.jl', jlEnvPath, '--debug=no', telemetry.getCrashReportingPipename(), oldDepotPath, g_context.globalStoragePath];
    let serverArgsDebug = ['--startup-file=no', '--history-file=no', '--depwarn=no', `--project=${envForLSPath}`, 'main.jl', jlEnvPath, '--debug=yes', telemetry.getCrashReportingPipename(), oldDepotPath, g_context.globalStoragePath];
    let spawnOptions = {
        cwd: path.join(g_context.extensionPath, 'scripts', 'languageserver'),
        env: {
            JULIA_DEPOT_PATH: path.join(g_context.extensionPath, 'scripts', 'languageserver', 'julia_pkgdir'),
            JULIA_LOAD_PATH: process.platform == "win32" ? ';' : ':',
            HOME: process.env.HOME ? process.env.HOME : os.homedir()
        }
    };

    let jlexepath = await juliaexepath.getJuliaExePath();

    let serverOptions = {
        run: { command: jlexepath, args: serverArgsRun, options: spawnOptions },
        debug: { command: jlexepath, args: serverArgsDebug, options: spawnOptions }
    };

    let clientOptions: LanguageClientOptions = {
        documentSelector: ['julia', 'juliamarkdown'],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{jl,jmd}')
        },
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        traceOutputChannel: vscode.window.createOutputChannel('Julia Language Server trace')
    }

    // Create the language client and start the client.
    g_languageClient = new LanguageClient('julia', 'Julia Language Server', serverOptions, clientOptions);
    g_languageClient.registerProposedFeatures()
    g_languageClient.onTelemetry((data: any) => {
        if(data.command=='trace_event') {
            telemetry.traceEvent(data.message);
        }
        else if (data.command=='symserv_crash') {
            telemetry.traceEvent('symservererror');
            telemetry.handleNewCrashReport(data.name, data.message, data.stacktrace);
        }
        else if (data.command=='symserv_pkgload_crash') {
            telemetry.tracePackageLoadError(data.name, data.message)
        }
    });

    // Push the disposable to the context's subscriptions so that the
    // client can be deactivated on extension deactivation
    try {
        g_context.subscriptions.push(g_languageClient.start());
        setLanguageClient(g_languageClient);
    }
    catch (e) {

        vscode.window.showErrorMessage('Could not start the julia language server. Make sure the configuration setting julia.executablePath points to the julia binary.');
        g_languageClient = null;
    }

    g_languageClient.onReady().then(() => {
        g_languageClient.onNotification(g_serverFullTextNotification, (uri) => {
            let doc = vscode.workspace.textDocuments.find((value: vscode.TextDocument) => value.uri.toString() == uri)
            doc.getText()
            g_languageClient.sendNotification("julia/reloadText", { textDocument: { uri: uri, languageId: "julia", version: 1, text: doc.getText() } })
        })
    })
}

export class JuliaDebugConfigurationProvider
    implements vscode.DebugConfigurationProvider {

    public resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.DebugConfiguration> {

        return (async () => {
            if (!config.request) {
                config.request = 'launch';
            }

            if (!config.type) {
                config.type = 'julia';
            }

            if (!config.name) {
                config.name = 'Launch Julia';
            }

            if (!config.program && config.request != 'attach') {
                config.program = vscode.window.activeTextEditor.document.fileName;
            }

            if (!config.internalConsoleOptions) {
                config.internalConsoleOptions = "neverOpen";
            }

            if (!config.stopOnEntry) {
                config.stopOnEntry = false;
            }

            if (!config.cwd && config.request != 'attach') {
                config.cwd = '${workspaceFolder}';
            }

            if (!config.juliaEnv && config.request != 'attach') {                
                config.juliaEnv = '${command:activeJuliaEnvironment}';
            }

            return config;
        })();
    }

}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {

    createDebugAdapterDescriptor(_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        return (async () => {
            return new vscode.DebugAdapterInlineImplementation(<any>new JuliaDebugSession(g_context, await juliaexepath.getJuliaExePath()));
        })();
    }
}
