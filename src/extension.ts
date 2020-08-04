'use strict'
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { SeverityLevel } from 'applicationinsights/out/Declarations/Contracts'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import * as vslc from 'vscode-languageclient'
import { LanguageClient, LanguageClientOptions, RevealOutputChannelOn } from 'vscode-languageclient'
import { JuliaDebugFeature } from './debugger/debugFeature'
import { ProfilerResultsProvider } from './interactive/profiler'
import * as repl from './interactive/repl'
import * as jlpkgenv from './jlpkgenv'
import * as juliaexepath from './juliaexepath'
import * as openpackagedirectory from './openpackagedirectory'
import * as packagepath from './packagepath'
import * as smallcommands from './smallcommands'
import * as tasks from './tasks'
import * as telemetry from './telemetry'
import * as weave from './weave'

let g_languageClient: LanguageClient = null
let g_context: vscode.ExtensionContext = null

export async function activate(context: vscode.ExtensionContext) {
    await telemetry.init(context)
    try {

        telemetry.traceEvent('activate')

        telemetry.startLsCrashServer()

        g_context = context

        console.log('Activating extension language-julia')

        // Config change
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(changeConfig))

        // Language settings
        vscode.languages.setLanguageConfiguration('julia', {
            indentationRules: {
                increaseIndentPattern: /^(\s*|.*=\s*|.*@\w*\s*)[\w\s]*\b(if|while|for|function|macro|immutable|struct|type|let|quote|try|begin|.*\)\s*do|else|elseif|catch|finally)\b(?!.*\bend\b[^\]]*$).*$/,
                decreaseIndentPattern: /^\s*(end|else|elseif|catch|finally)\b.*$/
            }
        })

        // Active features from other files
        juliaexepath.activate(context)
        await juliaexepath.getJuliaExePath() // We run this function now and await to make sure we don't run in twice simultaneously later
        repl.activate(context)
        weave.activate(context)
        tasks.activate(context)
        smallcommands.activate(context)
        packagepath.activate(context)
        openpackagedirectory.activate(context)
        jlpkgenv.activate(context)

        context.subscriptions.push(new JuliaDebugFeature(context))

        // Start language server
        startLanguageServer()

        if (vscode.workspace.getConfiguration('julia').get<boolean>('enableTelemetry') === null) {
            vscode.window.showInformationMessage('To help improve the Julia extension, you can allow the development team to collect usage data. Read our [privacy statement](https://github.com/julia-vscode/julia-vscode/wiki/Privacy-Policy) to learn more how we use usage data and how to permanently hide this notification.', 'I agree to usage data collection')
                .then(telemetry_choice => {
                    if (telemetry_choice === 'I agree to usage data collection') {
                        vscode.workspace.getConfiguration('julia').update('enableTelemetry', true, true)
                    }
                })
        }

        context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('juliavsodeprofilerresults', new ProfilerResultsProvider()))

        const api = {
            version: 1,
            async getEnvironment() {
                return await jlpkgenv.getEnvPath()
            },
            async getJuliaPath() {
                return await juliaexepath.getJuliaExePath()
            }
        }

        return api
    }
    catch (err) {
        telemetry.handleNewCrashReportFromException(err, 'Extension')
        throw (err)
    }
}

// this method is called when your extension is deactivated
export function deactivate() { }

const g_onSetLanguageClient = new vscode.EventEmitter<vslc.LanguageClient>()
export const onSetLanguageClient = g_onSetLanguageClient.event
function setLanguageClient(languageClient: vslc.LanguageClient = null) {
    g_onSetLanguageClient.fire(languageClient)
    g_languageClient = languageClient
}

const g_onDidChangeConfig = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>()
export const onDidChangeConfig = g_onDidChangeConfig.event
function changeConfig(event: vscode.ConfigurationChangeEvent) {
    g_onDidChangeConfig.fire(event)
    if (event.affectsConfiguration('julia.executablePath')) {
        if (g_languageClient !== null) {
            g_languageClient.stop()
            setLanguageClient()
        }
        startLanguageServer()
    }
}

async function startLanguageServer() {
    const startupNotification = vscode.window.createStatusBarItem()
    startupNotification.text = 'Starting Julia Language Server...'
    startupNotification.show()

    // let debugOptions = { execArgv: ["--nolazy", "--debug=6004"] };

    let jlEnvPath = ''
    try {
        jlEnvPath = await jlpkgenv.getEnvPath()
    }
    catch (e) {
        vscode.window.showErrorMessage('Could not start the julia language server. Make sure the configuration setting julia.executablePath points to the julia binary.')
        vscode.window.showErrorMessage(e)
        return
    }
    const oldDepotPath = process.env.JULIA_DEPOT_PATH ? process.env.JULIA_DEPOT_PATH : ''
    const envForLSPath = path.join(g_context.extensionPath, 'scripts', 'environments', 'languageserver')
    const serverArgsRun = ['--startup-file=no', '--history-file=no', '--depwarn=no', `--project=${envForLSPath}`, 'main.jl', jlEnvPath, '--debug=no', telemetry.getCrashReportingPipename(), oldDepotPath, g_context.globalStoragePath]
    const serverArgsDebug = ['--startup-file=no', '--history-file=no', '--depwarn=no', `--project=${envForLSPath}`, 'main.jl', jlEnvPath, '--debug=yes', telemetry.getCrashReportingPipename(), oldDepotPath, g_context.globalStoragePath]
    const spawnOptions = {
        cwd: path.join(g_context.extensionPath, 'scripts', 'languageserver'),
        env: {
            JULIA_DEPOT_PATH: path.join(g_context.extensionPath, 'scripts', 'languageserver', 'julia_pkgdir'),
            JULIA_LOAD_PATH: process.platform === 'win32' ? ';' : ':',
            HOME: process.env.HOME ? process.env.HOME : os.homedir()
        }
    }

    const jlexepath = await juliaexepath.getJuliaExePath()

    const serverOptions = {
        run: { command: jlexepath, args: serverArgsRun, options: spawnOptions },
        debug: { command: jlexepath, args: serverArgsDebug, options: spawnOptions }
    }

    const clientOptions: LanguageClientOptions = {
        documentSelector: ['julia', 'juliamarkdown'],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{jl,jmd}')
        },
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        traceOutputChannel: vscode.window.createOutputChannel('Julia Language Server trace'),
        middleware: {
            provideCompletionItem: async (document, position, context, token, next) => {

                const validatedPosition = document.validatePosition(position)

                if (validatedPosition !== position) {
                    telemetry.traceTrace({
                        message: `Middleware found a change in position in provideCompletionItem. Original ${position.line}:${position.character}, validated ${validatedPosition.line}:${validatedPosition.character}`,
                        severity: SeverityLevel.Error

                    })

                }

                return await next(document, position, context, token)
            },
            provideDefinition: async (document, position, token, next) => {

                const validatedPosition = document.validatePosition(position)

                if (validatedPosition !== position) {
                    telemetry.traceTrace({
                        message: `Middleware found a change in position in provideDefinition. Original ${position.line}:${position.character}, validated ${validatedPosition.line}:${validatedPosition.character}`,
                        severity: SeverityLevel.Error
                    })
                }

                return await next(document, position, token)
            }
        }
    }

    // Create the language client and start the client.
    const languageClient = new LanguageClient('julia', 'Julia Language Server', serverOptions, clientOptions)
    languageClient.registerProposedFeatures()
    languageClient.onTelemetry((data: any) => {
        if (data.command === 'trace_event') {
            telemetry.traceEvent(data.message)
        }
        else if (data.command === 'symserv_crash') {
            telemetry.traceEvent('symservererror')
            telemetry.handleNewCrashReport(data.name, data.message, data.stacktrace, 'Symbol Server')
        }
        else if (data.command === 'symserv_pkgload_crash') {
            telemetry.tracePackageLoadError(data.name, data.message)
        }
    })

    const disposable = vscode.commands.registerCommand('language-julia.showLanguageServerOutput', () => {
        languageClient.outputChannel.show(true)
    })
    try {
        // Push the disposable to the context's subscriptions so that the  client can be deactivated on extension deactivation
        g_context.subscriptions.push(languageClient.start())
        startupNotification.command = 'language-julia.showLanguageServerOutput'
        languageClient.onReady().then(() => {
            setLanguageClient(languageClient)
        }).finally(() => {
            disposable.dispose()
            startupNotification.dispose()
        })
    }
    catch (e) {
        vscode.window.showErrorMessage('Could not start the julia language server. Make sure the configuration setting julia.executablePath points to the julia binary.')
        setLanguageClient()
        disposable.dispose()
        startupNotification.dispose()
    }
}
