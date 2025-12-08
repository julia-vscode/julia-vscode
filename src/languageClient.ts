import * as fs from 'async-file'
import { unwatchFile, watchFile } from 'async-file'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import { LanguageClient, LanguageClientOptions, RevealOutputChannelOn, ServerOptions } from 'vscode-languageclient/node'
import * as semver from 'semver'

import * as jlpkgenv from './jlpkgenv'
import * as telemetry from './telemetry'
import { JuliaExecutable, JuliaExecutablesFeature } from './juliaexepath'
import { registerCommand } from './utils'

export const supportedSchemes = ['file', 'untitled', 'vscode-notebook-cell']
const supportedLanguages = ['julia', 'juliamarkdown', 'markdown']

export class LanguageClientFeature {
    private onDidSetLanguageClientEmitter = new vscode.EventEmitter<LanguageClient>()
    public onDidSetLanguageClient = this.onDidSetLanguageClientEmitter.event

    private onDidChangeConfigEmitter = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>()
    public onDidChangeConfig = this.onDidChangeConfigEmitter.event

    private outputChannel: vscode.OutputChannel = vscode.window.createOutputChannel('Julia Language Server')
    private traceOutputChannel: vscode.OutputChannel = vscode.window.createOutputChannel('Julia Language Server Trace')

    private statusBarItem: vscode.StatusBarItem = vscode.window.createStatusBarItem()

    private watchedEnvironment: string

    languageClient: LanguageClient

    constructor(
        private context: vscode.ExtensionContext,
        private executable: JuliaExecutablesFeature
    ) {
        this.context.subscriptions.push(
            registerCommand('language-julia.refreshLanguageServer', () => this.refreshLanguageServer()),
            registerCommand('language-julia.restartLanguageServer', (env?: string) => this.restartLanguageServer(env)),
            registerCommand('language-julia.showLanguageServerOutput', () => {
                this.outputChannel.show(true)
            }),
            vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
                this.onDidChangeConfigEmitter.fire(event)
                if (
                    event.affectsConfiguration('julia.executablePath') ||
                    event.affectsConfiguration('julia.languageServerJuliaupChannel') ||
                    event.affectsConfiguration('julia.languageServerExecutablePath')
                ) {
                    this.restartLanguageServer()
                }
            })
        )
    }

    public setLanguageClient(languageClient: LanguageClient = null) {
        this.onDidSetLanguageClientEmitter.fire(languageClient)
        this.languageClient = languageClient
    }

    public async withLanguageClient<T, E>(
        callback: (languageClient: LanguageClient) => T,
        callbackOnHandledErr: (err: Error) => E
    ) {
        if (this.languageClient === null) {
            return callbackOnHandledErr(new Error('Language client is not active'))
        }

        try {
            return await callback(this.languageClient)
        } catch (err) {
            if (err.message === 'Language client is not ready yet') {
                return callbackOnHandledErr(err)
            }
            throw err
        }
    }

    public async startServer(envPath?: string) {
        this.statusBarItem.text = 'Julia: Starting Language Server…'
        this.statusBarItem.backgroundColor = undefined
        this.statusBarItem.color = undefined
        this.statusBarItem.show()

        let juliaLSExecutable: JuliaExecutable | null = null
        const juliaExecutable = await this.executable.getActiveLanguageServerJuliaExecutableAsync()

        if (!juliaExecutable) {
            this.statusBarItem.text = 'Julia: Not installed'
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground')
            this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground')
            return
        }

        if (await this.executable.isJuliaup()) {
            if (process.env.DEBUG_MODE) {
                juliaLSExecutable = await this.executable.getActiveJuliaExecutableAsync()
            } else {
                const exePaths = await this.executable.getJuliaExePathsAsync()

                // Determine which juliaup channel to use (priority: env var > config > default)
                const preferredChannel =
                    process.env.JULIA_VSCODE_LANGUAGESERVER_CHANNEL ||
                    vscode.workspace.getConfiguration('julia').get<string>('languageServerJuliaupChannel') ||
                    'release'

                let channelExe = exePaths.filter((i) => i.channel === preferredChannel)

                // Fallback to release if preferred channel not available
                if (channelExe.length === 0 && preferredChannel !== 'release') {
                    channelExe = exePaths.filter((i) => i.channel === 'release')
                }

                if (channelExe.length > 0) {
                    juliaLSExecutable = channelExe[0]
                } else {
                    vscode.window.showErrorMessage(
                        `Julia channel "${preferredChannel}" not found in Juliaup. Please ensure the channel is installed, or configure a different channel via the "julia.languageServerJuliaupChannel" setting or JULIA_VSCODE_LANGUAGESERVER_CHANNEL environment variable.`
                    )
                    this.statusBarItem.hide()
                    return
                }

                if (juliaExecutable === undefined) {
                    vscode.window.showErrorMessage(
                        'You must have Julia installed for the best Julia experience in VS Code. You can download Julia from https://julialang.org/.'
                    )
                    this.statusBarItem.hide()
                    return
                }
            }
        } else {
            if (juliaExecutable === undefined) {
                vscode.window.showErrorMessage(
                    'You must have Julia installed for the best Julia experience in VS Code. You can download Julia from https://julialang.org/.'
                )
                this.statusBarItem.hide()
                return
            }

            if (semver.gte(juliaExecutable.getVersion(), '1.10.0')) {
                juliaLSExecutable = juliaExecutable
            } else {
                vscode.window.showErrorMessage(
                    'You must have at least Julia 1.10 installed for the best Julia experience in VS Code. You can download Julia from https://julialang.org/.'
                )
                this.statusBarItem.hide()
                return
            }
        }

        let jlEnvPath = ''
        if (envPath) {
            jlEnvPath = envPath
        } else {
            try {
                jlEnvPath = await jlpkgenv.getAbsEnvPath()
            } catch (e) {
                this.outputChannel.appendLine(
                    'Could not start the Julia language server. Make sure the `julia.environmentPath` setting is valid.'
                )
                this.outputChannel.appendLine(e)
                vscode.window
                    .showErrorMessage(
                        'Could not start the Julia language server. Make sure the `julia.environmentPath` setting is valid. ',
                        'Open Settings'
                    )
                    .then((val) => {
                        if (val) {
                            vscode.commands.executeCommand('workbench.action.openSettings', 'julia.environmentPath')
                        }
                    })
                this.statusBarItem.hide()
                return
            }
        }

        const storagePath = this.context.globalStorageUri.fsPath
        const useSymserverDownloads = vscode.workspace.getConfiguration('julia').get('symbolCacheDownload')
            ? 'download'
            : 'local'
        const symserverUpstream = vscode.workspace.getConfiguration('julia').get<string>('symbolserverUpstream')

        const languageServerDepotPath = path.join(storagePath, 'lsdepot', 'v1')
        await fs.createDirectory(languageServerDepotPath)
        const oldDepotPath = process.env.JULIA_DEPOT_PATH ? process.env.JULIA_DEPOT_PATH : ''
        const serverArgsRun: string[] = [
            '--startup-file=no',
            '--history-file=no',
            '--depwarn=no',
            'main.jl',
            jlEnvPath,
            '--debug=no',
            telemetry.getCrashReportingPipename(),
            oldDepotPath,
            storagePath,
            useSymserverDownloads,
            symserverUpstream,
            '--detached=no',
            juliaExecutable.getCommand(),
            juliaExecutable.version,
        ]
        const serverArgsDebug: string[] = [
            '--startup-file=no',
            '--history-file=no',
            '--depwarn=no',
            'main.jl',
            jlEnvPath,
            '--debug=yes',
            telemetry.getCrashReportingPipename(),
            oldDepotPath,
            storagePath,
            useSymserverDownloads,
            symserverUpstream,
            '--detached=no',
            juliaExecutable.getCommand(),
            juliaExecutable.version,
        ]
        const spawnOptions = {
            cwd: path.join(this.context.extensionPath, 'scripts', 'languageserver'),
            env: {
                JULIA_DEPOT_PATH: languageServerDepotPath + path.delimiter,
                JULIA_LOAD_PATH: path.delimiter,
                HOME: process.env.HOME ? process.env.HOME : os.homedir(),
                JULIA_LANGUAGESERVER: '1',
                JULIA_VSCODE_LANGUAGESERVER: '1',
                JULIA_VSCODE_INTERNAL: '1',
                PATH: process.env.PATH,
            },
        }

        const serverOptions: ServerOptions = process.env.DETACHED_LS
            ? async () => {
                  // TODO Add some loop here that retries in case the LSP is not yet ready
                  const conn = net.connect(7777)
                  return { reader: conn, writer: conn, detached: true }
              }
            : {
                  run: {
                      command: juliaLSExecutable.file,
                      args: [...juliaLSExecutable.args, ...serverArgsRun],
                      options: spawnOptions,
                  },
                  debug: {
                      command: juliaLSExecutable.file,
                      args: [...juliaLSExecutable.args, ...serverArgsDebug],
                      options: spawnOptions,
                  },
              }

        const selector = []
        for (const scheme of supportedSchemes) {
            for (const language of supportedLanguages) {
                selector.push({
                    language,
                    scheme,
                })
            }

            selector.push({ language: 'toml', scheme: scheme, pattern: '**/Project.toml' })
            selector.push({ language: 'toml', scheme: scheme, pattern: '**/JuliaProject.toml' })
            selector.push({ language: 'toml', scheme: scheme, pattern: '**/Manifest.toml' })
            selector.push({ language: 'toml', scheme: scheme, pattern: '**/JuliaManifest.toml' })
            selector.push({ language: 'toml', scheme: scheme, pattern: '**/.JuliaLint.toml' })
        }

        const clientOptions: LanguageClientOptions = {
            documentSelector: selector,
            revealOutputChannelOn: RevealOutputChannelOn.Never,
            traceOutputChannel: this.traceOutputChannel,
            outputChannel: this.outputChannel,
            initializationOptions: { julialangTestItemIdentification: true },
        }

        // Create the language client and start the client.
        const languageClient = new LanguageClient('julia', 'Julia Language Server', serverOptions, clientOptions)
        languageClient.registerProposedFeatures()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        languageClient.onTelemetry((data: any) => {
            if (data.command === 'trace_event') {
                telemetry.traceEvent(data.message)
            } else if (data.command === 'symserv_crash') {
                telemetry.traceEvent('symservererror')
                telemetry.handleNewCrashReport(data.name, data.message, data.stacktrace, 'Symbol Server')
            } else if (data.command === 'symserv_pkgload_crash') {
                telemetry.tracePackageLoadError(data.name, data.message)
            } else if (data.command === 'request_metric') {
                telemetry.traceRequest(
                    data.operationId,
                    data.operationParentId,
                    data.name,
                    new Date(data.time),
                    data.duration,
                    'Language Server'
                )
            }
        })

        if (this.watchedEnvironment) {
            unwatchFile(this.watchedEnvironment)
        }

        // automatic environement refreshing
        this.watchedEnvironment = (await jlpkgenv.getProjectFilePaths(jlEnvPath)).manifest_toml_path
        // polling watch for robustness
        if (this.watchedEnvironment) {
            watchFile(this.watchedEnvironment, { interval: 10000 }, async (curr, prev) => {
                if (curr.mtime > prev.mtime) {
                    if (!languageClient.needsStop()) {
                        return
                    } // this client already gets stopped
                    await this.refreshLanguageServer()
                }
            })
        }

        try {
            this.statusBarItem.command = 'language-julia.showLanguageServerOutput'
            await languageClient.start()
            this.setLanguageClient(languageClient)
        } catch {
            vscode.window
                .showErrorMessage(
                    'Could not start the Julia language server. Make sure the configuration setting julia.executablePath points to the Julia binary.',
                    'Open Settings'
                )
                .then((val) => {
                    if (val) {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'julia.executablePath')
                    }
                })
            this.setLanguageClient()
        }
        this.statusBarItem.hide()
    }

    async refreshLanguageServer() {
        if (!this.languageClient) {
            return
        }
        try {
            await this.languageClient.sendNotification('julia/refreshLanguageServer')
        } catch (err) {
            vscode.window.showErrorMessage('Failed to refresh the language server cache.', {
                detail: err,
            })
        }
    }

    async restartLanguageServer(envPath?: string) {
        if (this.languageClient !== null) {
            try {
                await this.languageClient.stop()
            } catch (err) {
                console.debug(`Stopping the language server failed: ${err}`)
            }
            this.setLanguageClient()
        }

        await this.startServer(envPath)
    }

    public async dispose(): Promise<void> {
        if (this.languageClient) {
            await this.languageClient.stop()
        }

        this.statusBarItem.dispose()
        this.outputChannel.dispose()
        this.traceOutputChannel.dispose()
    }
}
