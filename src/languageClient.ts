import * as fs from 'async-file'
import { unwatchFile, watchFile } from 'async-file'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import { LanguageClient, LanguageClientOptions, RevealOutputChannelOn, ServerOptions } from 'vscode-languageclient/node'

import * as jlpkgenv from './jlpkgenv'
import * as telemetry from './telemetry'
import { ExecutableFeature, JuliaExecutable } from './executables'
import { registerCommand } from './utils'
import { ExtensionStatusManager, WorkerStatus } from './statusPane/extensionStatus'

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

    private serverStarting: boolean = false

    languageClient: LanguageClient

    constructor(
        private context: vscode.ExtensionContext,
        private executable: ExecutableFeature,
        private statusManager?: ExtensionStatusManager
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
        if (this.serverStarting) {
            return
        }

        this.serverStarting = true
        try {
            await this.startServerInner(envPath)
        } finally {
            this.serverStarting = false
        }
    }

    public async startServerInner(envPath?: string) {
        let juliaExecutable: JuliaExecutable

        try {
            juliaExecutable = await this.executable.getLsExecutable()
        } catch {
            this.statusBarItem.text = 'Julia: Not installed'
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground')
            this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground')
            this.statusBarItem.command = 'language-julia.restartLanguageServer'
            this.statusBarItem.show()

            if (this.statusManager) {
                this.statusManager.updateWorkerStatus('languageServer', WorkerStatus.Error, 'Julia not installed')
            }

            return
        }

        this.statusBarItem.text = 'Julia: Starting Language Server…'
        this.statusBarItem.backgroundColor = undefined
        this.statusBarItem.color = undefined
        this.statusBarItem.show()

        if (this.statusManager) {
            this.statusManager.updateWorkerStatus('languageServer', WorkerStatus.Starting, 'Starting language server...')
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
                if (this.statusManager) {
                    this.statusManager.updateWorkerStatus('languageServer', WorkerStatus.Error, 'Invalid environment path', e.toString())
                }
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
            juliaExecutable.command,
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
            juliaExecutable.command,
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
                      command: juliaExecutable.command,
                      args: [...juliaExecutable.args, ...serverArgsRun],
                      options: spawnOptions,
                  },
                  debug: {
                      command: juliaExecutable.command,
                      args: [...juliaExecutable.args, ...serverArgsDebug],
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
        
        // Listen for progress notifications from language server
        languageClient.onNotification('$/progress', (params: any) => {
            if (this.statusManager && params.value) {
                const value = params.value
                if (value.kind === 'begin') {
                    if (value.title?.includes('Indexing') || value.message?.includes('Indexing')) {
                        this.statusManager.updateWorkerStatus('indexing', WorkerStatus.Indexing, value.title || value.message, undefined, 'languageServer')
                    } else if (value.title?.includes('download') || value.message?.includes('download')) {
                        this.statusManager.updateWorkerStatus('downloading', WorkerStatus.DownloadingCache, value.title || value.message, undefined, 'languageServer')
                    } else if (value.title) {
                        this.statusManager.updateWorkerStatus('lsProgress', WorkerStatus.Starting, value.title, undefined, 'languageServer')
                    }
                } else if (value.kind === 'end') {
                    // Remove sub-tasks when complete
                    if (value.title?.includes('Indexing')) {
                        this.statusManager.removeWorker('indexing')
                    } else if (value.title?.includes('download')) {
                        this.statusManager.removeWorker('downloading')
                    } else {
                        this.statusManager.removeWorker('lsProgress')
                    }
                }
            }
        })
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        languageClient.onTelemetry((data: any) => {
            if (data.command === 'trace_event') {
                telemetry.traceEvent(data.message)
            } else if (data.command === 'symserv_crash') {
                telemetry.traceEvent('symservererror')
                telemetry.handleNewCrashReport(data.name, data.message, data.stacktrace, 'Symbol Server')
                if (this.statusManager) {
                    this.statusManager.updateWorkerStatus('languageServer', WorkerStatus.Error, 'Symbol server crashed', data.message)
                }
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
            if (this.statusManager) {
                this.statusManager.updateWorkerStatus('languageServer', WorkerStatus.Precompiling, 'Precompiling language server...')
            }
            await languageClient.start()
            
            // Language server is now started, set to indexing state initially
            if (this.statusManager) {
                this.statusManager.updateWorkerStatus('languageServer', WorkerStatus.Indexing, 'Initializing workspace...')
                // Set ready after a short delay to allow initialization
                setTimeout(() => {
                    if (this.statusManager && languageClient === this.languageClient) {
                        this.statusManager.updateWorkerStatus('languageServer', WorkerStatus.Ready, 'Language server ready')
                    }
                }, 2000)
            }
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
            if (this.statusManager) {
                this.statusManager.updateWorkerStatus('languageServer', WorkerStatus.Error, 'Failed to start language server')
            }
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
        if (this.languageClient) {
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
