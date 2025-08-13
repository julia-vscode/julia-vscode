'use strict'
import * as sourcemapsupport from 'source-map-support'
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as fs from 'async-file'
import { unwatchFile, watchFile } from 'async-file'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import { LanguageClient, LanguageClientOptions, RevealOutputChannelOn, ServerOptions, State } from 'vscode-languageclient/node'
import * as debugViewProvider from './debugger/debugConfig'
import { JuliaDebugFeature } from './debugger/debugFeature'
import * as documentation from './docbrowser/documentation'
import { ProfilerFeature } from './interactive/profiler'
import * as repl from './interactive/repl'
import { WorkspaceFeature } from './interactive/workspace'
import * as jlpkgenv from './jlpkgenv'
import { JuliaExecutable, JuliaExecutablesFeature } from './juliaexepath'
import { JuliaNotebookFeature } from './notebook/notebookFeature'
import * as openpackagedirectory from './openpackagedirectory'
import { JuliaPackageDevFeature } from './packagedevtools'
import * as packagepath from './packagepath'
import * as smallcommands from './smallcommands'
import * as tasks from './tasks'
import * as telemetry from './telemetry'
import { TestFeature } from './testing/testFeature'
import {notifyTypeTextDocumentPublishTests} from './testing/testLSProtocol'
import { registerCommand, setContext } from './utils'
import * as weave from './weave'
import { handleNewCrashReportFromException } from './telemetry'
import { JuliaGlobalDiagnosticOutputFeature } from './globalDiagnosticOutput'
import * as semver from 'semver'

sourcemapsupport.install({ handleUncaughtExceptions: false })

let g_languageClient: LanguageClient = null
let g_context: vscode.ExtensionContext = null
let g_watchedEnvironmentFile: string = null
let g_startupNotification: vscode.StatusBarItem = null
let g_juliaExecutablesFeature: JuliaExecutablesFeature = null
let g_testFeature: TestFeature = null

let g_traceOutputChannel: vscode.OutputChannel = null
let g_outputChannel: vscode.OutputChannel = null

export const increaseIndentPattern: RegExp = /^(\s*|.*=\s*|.*@\w*\s*)[\w\s]*(?:["'`][^"'`]*["'`])*[\w\s]*\b(if|while|for|function|macro|(mutable\s+)?struct|abstract\s+type|primitive\s+type|let|quote|try|begin|.*\)\s*do|else|elseif|catch|finally)\b(?!(?:.*\bend\b(\s*|\s*#.*)$)|(?:[^\[]*\].*)$).*$/
export const decreaseIndentPattern: RegExp = /^\s*(end|else|elseif|catch|finally)\b.*$/

export async function activate(context: vscode.ExtensionContext) {
    await telemetry.init(context)
    try {
        setContext('julia.isActive', true)

        telemetry.traceEvent('activate')

        telemetry.startLsCrashServer()

        g_context = context

        const globalDiagnosticOutputFeature = new JuliaGlobalDiagnosticOutputFeature()
        context.subscriptions.push(globalDiagnosticOutputFeature)

        console.debug('Activating extension language-julia')

        // Config change
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(changeConfig))

        // Language settings
        vscode.languages.setLanguageConfiguration('julia', {
            indentationRules: {
                increaseIndentPattern: increaseIndentPattern,
                decreaseIndentPattern: decreaseIndentPattern
            }
        })

        const profilerFeature = new ProfilerFeature(context)
        context.subscriptions.push(profilerFeature)

        // Active features from other files
        const compiledProvider = debugViewProvider.activate(context)
        g_juliaExecutablesFeature = new JuliaExecutablesFeature(context, globalDiagnosticOutputFeature)
        context.subscriptions.push(g_juliaExecutablesFeature)
        await g_juliaExecutablesFeature.getActiveJuliaExecutableAsync() // We run this function now and await to make sure we don't run in twice simultaneously later
        repl.activate(context, compiledProvider, g_juliaExecutablesFeature, profilerFeature)
        weave.activate(context, g_juliaExecutablesFeature)
        documentation.activate(context)
        tasks.activate(context, g_juliaExecutablesFeature)
        smallcommands.activate(context)
        packagepath.activate(context, g_juliaExecutablesFeature)
        openpackagedirectory.activate(context)
        jlpkgenv.activate(context, g_juliaExecutablesFeature)

        const workspaceFeature = new WorkspaceFeature(context)
        context.subscriptions.push(workspaceFeature)
        const notebookFeature = new JuliaNotebookFeature(context, g_juliaExecutablesFeature, workspaceFeature, compiledProvider)
        context.subscriptions.push(notebookFeature)
        context.subscriptions.push(new JuliaPackageDevFeature(context, g_juliaExecutablesFeature))
        g_testFeature = new TestFeature(context, g_juliaExecutablesFeature, workspaceFeature, compiledProvider)
        context.subscriptions.push(g_testFeature)
        context.subscriptions.push(new JuliaDebugFeature(context, compiledProvider, g_juliaExecutablesFeature, notebookFeature))

        g_startupNotification = vscode.window.createStatusBarItem()
        context.subscriptions.push(g_startupNotification)

        context.subscriptions.push(registerCommand('language-julia.showLanguageServerOutput', () => {
            if (g_languageClient) {
                g_languageClient.outputChannel.show(true)
            }
        }))

        if (vscode.workspace.getConfiguration('julia').get<boolean>('symbolCacheDownload') === null) {
            vscode.window.showInformationMessage('The extension will now download symbol server cache files from GitHub, if possible. You can disable this behaviour in the settings.', 'Open Settings').then(val => {
                if (val) {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'julia.symbolCacheDownload')
                }
            })
            vscode.workspace.getConfiguration('julia').update('symbolCacheDownload', true, vscode.ConfigurationTarget.Global)
        }

        // Start language server
        startLanguageServer(g_juliaExecutablesFeature)

        if (vscode.workspace.getConfiguration('julia').get<boolean>('enableTelemetry') === null) {
            const agree = 'Yes'
            const disagree = 'No'
            vscode.window.showInformationMessage('To help improve the Julia extension, you can allow the development team to collect usage data. Read our [privacy statement](https://github.com/julia-vscode/julia-vscode/wiki/Privacy-Policy) to learn more about how we use usage data. Do you agree to usage data collection?', agree, disagree)
                .then(choice => {
                    if (choice === agree) {
                        vscode.workspace.getConfiguration('julia').update('enableTelemetry', true, vscode.ConfigurationTarget.Global)
                    } else if (choice === disagree) {
                        vscode.workspace.getConfiguration('julia').update('enableTelemetry', false, vscode.ConfigurationTarget.Global)
                    }
                })
        }

        context.subscriptions.push(
            // commands
            registerCommand('language-julia.refreshLanguageServer', refreshLanguageServer),
            registerCommand('language-julia.restartLanguageServer', restartLanguageServer)
        )

        const api = {
            version: 4,
            async getEnvironment() {
                return await jlpkgenv.getAbsEnvPath()
            },
            async getJuliaExecutable() {
                return await g_juliaExecutablesFeature.getActiveJuliaExecutableAsync()
            },
            async getJuliaPath() {
                console.warn('Julia extension for VSCode: `getJuliaPath` API is deprecated.')
                return (await g_juliaExecutablesFeature.getActiveJuliaExecutableAsync()).file
            },
            getPkgServer() {
                return vscode.workspace.getConfiguration('julia').get('packageServer')
            },
            executeInREPL: repl.executeInREPL
        }

        return api
    }
    catch (err) {
        telemetry.handleNewCrashReportFromException(err, 'Extension')
        throw (err)
    }
}

// this method is called when your extension is deactivated
export function deactivate() {
    const promises = []

    promises.push(repl.deactivate())

    if (g_languageClient) {
        promises.push(g_languageClient.stop())
    }

    telemetry.flush()

    return Promise.all(promises)
}

const g_onSetLanguageClient = new vscode.EventEmitter<LanguageClient>()
export const onSetLanguageClient = g_onSetLanguageClient.event
function setLanguageClient(languageClient: LanguageClient = null) {
    g_onSetLanguageClient.fire(languageClient)
    g_languageClient = languageClient
}

export async function withLanguageClient(
    callback: (languageClient: LanguageClient) => any,
    callbackOnHandledErr: (err: Error) => any
) {
    if (g_languageClient === null) {
        return callbackOnHandledErr(new Error('Language client is not active'))
    }

    try {
        return await callback(g_languageClient)
    } catch (err) {
        if (err.message === 'Language client is not ready yet') {
            return callbackOnHandledErr(err)
        }
        throw err
    }
}

const g_onDidChangeConfig = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>()
export const onDidChangeConfig = g_onDidChangeConfig.event
function changeConfig(event: vscode.ConfigurationChangeEvent) {
    g_onDidChangeConfig.fire(event)
    if (event.affectsConfiguration('julia.executablePath')) {
        restartLanguageServer()
    }
}

export const supportedSchemes = [
    'file',
    'untitled',
    'vscode-notebook-cell'
]

const supportedLanguages = [
    'julia',
    'juliamarkdown',
    'markdown'
]

async function startLanguageServer(juliaExecutablesFeature: JuliaExecutablesFeature) {
    g_startupNotification.text = 'Julia: Starting Language Server…'
    g_startupNotification.show()

    let juliaLSExecutable: JuliaExecutable | null = null
    const juliaExecutable = await juliaExecutablesFeature.getActiveLaunguageServerJuliaExecutableAsync()

    if(await juliaExecutablesFeature.isJuliaup()) {
        if (Boolean(process.env.DEBUG_MODE)) {
            juliaLSExecutable = await juliaExecutablesFeature.getActiveJuliaExecutableAsync()
        } else {
            const exePaths = await juliaExecutablesFeature.getJuliaExePathsAsync()

            // Determine which juliaup channel to use (priority: env var > config > default)
            const preferredChannel = process.env.JULIA_VSCODE_LANGUAGESERVER_CHANNEL || 
                                   vscode.workspace.getConfiguration('julia').get<string>('languageServerJuliaupChannel') || 
                                   'release'

            let channelExe = exePaths.filter(i => i.channel === preferredChannel)

            // Fallback to release if preferred channel not available
            if (channelExe.length === 0 && preferredChannel !== 'release') {
                channelExe = exePaths.filter(i => i.channel === 'release')
            }

            if (channelExe.length > 0) {
                juliaLSExecutable = channelExe[0]
            } else {
                const channelSource = process.env.JULIA_VSCODE_LANGUAGESERVER_CHANNEL ? 'environment variable' : 'configuration setting'
                vscode.window.showErrorMessage(`Julia channel "${preferredChannel}" not found in Juliaup. Please ensure the channel is installed, or configure a different channel via the "julia.languageServerJuliaupChannel" setting or JULIA_VSCODE_LANGUAGESERVER_CHANNEL environment variable.`)
                g_startupNotification.hide()
                return
            }

            if (juliaExecutable===undefined) {
                vscode.window.showErrorMessage('You must have Julia installed for the best Julia experience in VS Code. You can download Julia from https://julialang.org/.')
                g_startupNotification.hide()
                return
            }
        }
    }
    else {
        if (juliaExecutable === undefined) {
            vscode.window.showErrorMessage('You must have Julia installed for the best Julia experience in VS Code. You can download Julia from https://julialang.org/.')
            g_startupNotification.hide()
            return
        }

        if(semver.gte(juliaExecutable.getVersion(), '1.10.0')) {
            juliaLSExecutable = juliaExecutable
        }
        else {
            vscode.window.showErrorMessage('You must have at least Julia 1.10 installed for the best Julia experience in VS Code. You can download Julia from https://julialang.org/.')
            g_startupNotification.hide()
            return
        }
    }

    let jlEnvPath = ''
    try {
        jlEnvPath = await jlpkgenv.getAbsEnvPath()
    } catch (e) {
        vscode.window.showErrorMessage(
            'Could not start the Julia language server. Make sure the `julia.executablePath` setting is valid.',
            'Open Settings'
        ).then(val => {
            if (val) {
                vscode.commands.executeCommand('workbench.action.openSettings', 'julia.executablePath')
            }
        })
        g_startupNotification.hide()
        return
    }

    const storagePath = g_context.globalStorageUri.fsPath
    const useSymserverDownloads = vscode.workspace.getConfiguration('julia').get('symbolCacheDownload') ? 'download' : 'local'
    const symserverUpstream = vscode.workspace.getConfiguration('julia').get<string>('symbolserverUpstream')

    const languageServerDepotPath = path.join(storagePath, 'lsdepot', 'v1')
    await fs.createDirectory(languageServerDepotPath)
    const oldDepotPath = process.env.JULIA_DEPOT_PATH ? process.env.JULIA_DEPOT_PATH : ''
    const serverArgsRun: string[] = ['--startup-file=no', '--history-file=no', '--depwarn=no', 'main.jl', jlEnvPath, '--debug=no', telemetry.getCrashReportingPipename(), oldDepotPath, storagePath, useSymserverDownloads, symserverUpstream, '--detached=no', juliaExecutable.getCommand(), juliaExecutable.version]
    const serverArgsDebug: string[] = ['--startup-file=no', '--history-file=no', '--depwarn=no', 'main.jl', jlEnvPath, '--debug=yes', telemetry.getCrashReportingPipename(), oldDepotPath, storagePath, useSymserverDownloads, symserverUpstream, '--detached=no', juliaExecutable.getCommand(), juliaExecutable.version]
    const spawnOptions = {
        cwd: path.join(g_context.extensionPath, 'scripts', 'languageserver'),
        env: {
            JULIA_DEPOT_PATH: languageServerDepotPath,
            JULIA_LOAD_PATH: process.platform === 'win32' ? ';' : ':',
            HOME: process.env.HOME ? process.env.HOME : os.homedir(),
            JULIA_LANGUAGESERVER: '1',
            JULIA_VSCODE_LANGUAGESERVER: '1',
            JULIA_VSCODE_INTERNAL: '1',
            PATH: process.env.PATH
        }
    }

    const serverOptions: ServerOptions = Boolean(process.env.DETACHED_LS) ?
        async () => {
            // TODO Add some loop here that retries in case the LSP is not yet ready
            const conn = net.connect(7777)
            return { reader: conn, writer: conn, detached: true }
        } :
        {
            run: { command: juliaLSExecutable.file, args: [...juliaLSExecutable.args, ...serverArgsRun], options: spawnOptions },
            debug: { command: juliaLSExecutable.file, args: [...juliaLSExecutable.args, ...serverArgsDebug], options: spawnOptions }
        }

    const selector = []
    for (const scheme of supportedSchemes) {
        for (const language of supportedLanguages) {
            selector.push({
                language,
                scheme
            })
        }

        selector.push({language: 'toml', scheme: scheme, pattern: '**/Project.toml'})
        selector.push({language: 'toml', scheme: scheme, pattern: '**/JuliaProject.toml'})
        selector.push({language: 'toml', scheme: scheme, pattern: '**/Manifest.toml'})
        selector.push({language: 'toml', scheme: scheme, pattern: '**/JuliaManifest.toml'})
        selector.push({language: 'toml', scheme: scheme, pattern: '**/.JuliaLint.toml'})
    }

    if (!g_outputChannel) {
        g_outputChannel = vscode.window.createOutputChannel('Julia Language Server')
    }
    if (!g_traceOutputChannel) {
        g_traceOutputChannel = vscode.window.createOutputChannel('Julia Language Server Trace')
    }

    const clientOptions: LanguageClientOptions = {
        documentSelector: selector,
        revealOutputChannelOn: RevealOutputChannelOn.Never,
        traceOutputChannel: g_traceOutputChannel,
        outputChannel: g_outputChannel,
        initializationOptions: {julialangTestItemIdentification: true},
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
        else if (data.command === 'request_metric') {
            telemetry.traceRequest(data.operationId, data.operationParentId, data.name, new Date(data.time), data.duration, 'Language Server')
        }
    })

    languageClient.onDidChangeState(event => {
        if (event.newState === State.Running) {
            languageClient.onNotification(notifyTypeTextDocumentPublishTests, i=> {
                try {
                    g_testFeature.publishTestsHandler(i)
                }
                catch (err) {
                    handleNewCrashReportFromException(err, 'Extension')
                    throw (err)
                }
            })
        }
    })

    if (g_watchedEnvironmentFile) {
        unwatchFile(g_watchedEnvironmentFile)
    }

    // automatic environement refreshing
    g_watchedEnvironmentFile = (await jlpkgenv.getProjectFilePaths(jlEnvPath)).manifest_toml_path
    // polling watch for robustness
    if (g_watchedEnvironmentFile) {
        watchFile(g_watchedEnvironmentFile, { interval: 10000 }, async (curr, prev) => {
            if (curr.mtime > prev.mtime) {
                if (!languageClient.needsStop()) { return } // this client already gets stopped
                await refreshLanguageServer(languageClient)
            }
        })
    }

    try {
        g_startupNotification.command = 'language-julia.showLanguageServerOutput'
        setLanguageClient(languageClient)
        await languageClient.start()
    }
    catch (e) {
        vscode.window.showErrorMessage('Could not start the Julia language server. Make sure the configuration setting julia.executablePath points to the Julia binary.', 'Open Settings').then(val => {
            if (val) {
                vscode.commands.executeCommand('workbench.action.openSettings', 'julia.executablePath')
            }
        })
        setLanguageClient()
    }
    g_startupNotification.hide()
}

async function refreshLanguageServer(languageClient: LanguageClient = g_languageClient) {
    if (!languageClient) { return }
    try {
        await languageClient.sendNotification('julia/refreshLanguageServer')
    } catch (err) {
        vscode.window.showErrorMessage('Failed to refresh the language server cache.', {
            detail: err
        })
    }
}

async function restartLanguageServer(languageClient: LanguageClient = g_languageClient) {
    if (languageClient !== null) {
        await languageClient.stop()
        setLanguageClient()
    }
    await startLanguageServer(g_juliaExecutablesFeature)
}
