import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import {
    CloseAction,
    CloseHandlerResult,
    ErrorHandler,
    ErrorHandlerResult,
    LanguageClient,
    LanguageClientOptions,
    Message,
    RevealOutputChannelOn,
    ServerOptions,
    State,
    StateChangeEvent,
} from 'vscode-languageclient/node'
import { ErrorCodes, LSPErrorCodes, ResponseError } from 'vscode-languageserver-protocol'

import * as jlpkgenv from './jlpkgenv'
import * as telemetry from './telemetry'
import { ExecutableFeature, JuliaExecutable, JuliaNotFoundError } from './executables'
import { getCustomEnvironmentVariables, onEvent, registerCommand } from './utils'

export const supportedSchemes = ['file', 'untitled', 'vscode-notebook-cell']
const supportedLanguages = ['julia', 'juliamarkdown', 'markdown']

export type LanguageServerState = 'stopped' | 'starting' | 'running' | 'crashed'

/**
 * Returns true if the error is a result of the language server connection
 * being unavailable (crashed, stopped, not ready). These errors should be
 * handled gracefully without sending extension crash telemetry, since the
 * LS crash itself is already reported separately.
 */
export function isLanguageServerError(err: unknown): boolean {
    if (err instanceof ResponseError) {
        switch (err.code) {
            case ErrorCodes.PendingResponseRejected:
            case ErrorCodes.ConnectionInactive:
            case LSPErrorCodes.RequestCancelled:
            case LSPErrorCodes.ServerCancelled:
            case LSPErrorCodes.ContentModified:
                return true
        }
    }
    if (err instanceof Error) {
        if (err.message === 'Language client is not ready yet' || err.message === 'Client is not running') {
            return true
        }
    }
    return false
}

/**
 * Wraps the client's default error handler and remembers whether the last
 * connection close resulted in an auto-restart. The client fires a public
 * `Stopped` state change on every unexpected connection close, even when it
 * is about to restart the server itself, so the state change alone cannot
 * distinguish a transient crash from a crash loop the client has given up on.
 * The `closed()` decision is made before the state change fires, which lets
 * the state change handler consult `consumeRestartPending()`.
 */
export class RestartTrackingErrorHandler implements ErrorHandler {
    private delegate: ErrorHandler
    private restartPending: boolean = false

    constructor(private createDelegate: () => ErrorHandler) {}

    error(
        error: Error,
        message: Message | undefined,
        count: number | undefined
    ): ErrorHandlerResult | Promise<ErrorHandlerResult> {
        this.delegate ??= this.createDelegate()
        return this.delegate.error(error, message, count)
    }

    async closed(): Promise<CloseHandlerResult> {
        this.delegate ??= this.createDelegate()
        const result = await this.delegate.closed()
        if (result.action === CloseAction.Restart) {
            this.restartPending = true
        }
        return result
    }

    /**
     * Returns whether the last connection close is followed by an
     * auto-restart, and resets the flag.
     */
    consumeRestartPending(): boolean {
        const pending = this.restartPending
        this.restartPending = false
        return pending
    }
}

export class LanguageClientFeature {
    private onDidSetLanguageClientEmitter = new vscode.EventEmitter<LanguageClient>()
    public onDidSetLanguageClient = this.onDidSetLanguageClientEmitter.event

    private onDidChangeConfigEmitter = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>()
    public onDidChangeConfig = this.onDidChangeConfigEmitter.event

    private _onDidChangeStateEmitter = new vscode.EventEmitter<LanguageServerState>()
    public onDidChangeLsState = this._onDidChangeStateEmitter.event

    private outputChannel: vscode.OutputChannel = vscode.window.createOutputChannel('Julia Language Server')
    private traceOutputChannel: vscode.OutputChannel = vscode.window.createOutputChannel('Julia Language Server Trace')

    private statusBarItem: vscode.StatusBarItem = vscode.window.createStatusBarItem()

    private serverStarting: boolean = false

    private _state: LanguageServerState = 'stopped'
    private _intentionalStop: boolean = false

    languageClient: LanguageClient

    public get state(): LanguageServerState {
        return this._state
    }

    private setState(state: LanguageServerState) {
        if (this._state !== state) {
            this._state = state
            this._onDidChangeStateEmitter.fire(state)
            this.updateStatusBarForState()
        }
    }

    private updateStatusBarForState() {
        if (this._state === 'crashed') {
            this.statusBarItem.text = '$(warning) Julia Language Server Crashed'
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
            this.statusBarItem.command = 'language-julia.restartLanguageServer'
            this.statusBarItem.tooltip = 'The Julia Language Server has crashed. Click to restart.'
            this.statusBarItem.show()
        }
    }

    private async stopLanguageServer() {
        this._intentionalStop = true
        if (this.languageClient) {
            try {
                await this.languageClient.stop()
            } catch (err) {
                console.debug(`Stopping the language server failed: ${err}`)
            }
            this.setLanguageClient()
        }
        this.setState('stopped')
    }

    constructor(
        private context: vscode.ExtensionContext,
        private executable: ExecutableFeature
    ) {
        this.context.subscriptions.push(
            registerCommand('language-julia.restartLanguageServer', (env?: string) =>
                this.restartLanguageServer(env, true)
            ),
            registerCommand('language-julia.showLanguageServerOutput', async () => {
                this.outputChannel.show(true)
            }),
            onEvent(vscode.workspace.onDidChangeConfiguration, (event: vscode.ConfigurationChangeEvent) => {
                this.onDidChangeConfigEmitter.fire(event)
                if (
                    event.affectsConfiguration('julia.languageServerJuliaupChannel') ||
                    event.affectsConfiguration('julia.languageServerExecutablePath')
                ) {
                    this.restartLanguageServer()
                }
                if (event.affectsConfiguration('julia.environmentPath')) {
                    this.notifyServerEnvironmentPath()
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
        callbackOnHandledErr?: (err: Error) => E
    ): Promise<T | E | undefined> {
        if (this._state !== 'running' || this.languageClient === null) {
            const err = new Error('Language client is not active')
            return callbackOnHandledErr ? callbackOnHandledErr(err) : undefined
        }

        try {
            return await callback(this.languageClient)
        } catch (err) {
            if (isLanguageServerError(err)) {
                return callbackOnHandledErr ? callbackOnHandledErr(err) : undefined
            }
            throw err
        }
    }

    // Push the resolved environment path to the running server. The client owns
    // all path resolution; the server just applies the absolute path it receives.
    private async notifyServerEnvironmentPath() {
        try {
            let envPath: string
            try {
                envPath = await jlpkgenv.getResolvedEnvPathForLS()
            } catch (err) {
                if (err instanceof JuliaNotFoundError) {
                    return
                }
                throw err
            }

            await this.withLanguageClient((client) => client.sendNotification('julia/setEnvironmentPath', { envPath }))
        } catch (err) {
            this.outputChannel.appendLine(`Could not notify the language server of the environment change: ${err}`)
        }
    }

    public async startServer(envPath?: string, autoInstall?: boolean) {
        if (this.serverStarting) {
            return
        }

        this.serverStarting = true
        try {
            await this.startServerInner(envPath, autoInstall)
        } finally {
            this.serverStarting = false
        }
    }

    public async startServerInner(envPath?: string, autoInstall?: boolean) {
        this._intentionalStop = false

        let juliaExecutable: JuliaExecutable

        try {
            juliaExecutable = await this.executable.getLsExecutable(autoInstall)
        } catch {
            return
        }

        this.statusBarItem.text = 'Julia: Starting Language Server…'
        this.statusBarItem.backgroundColor = undefined
        this.statusBarItem.color = undefined
        this.statusBarItem.tooltip = undefined
        this.statusBarItem.show()

        let jlEnvPath: string
        if (envPath) {
            jlEnvPath = envPath
        } else {
            try {
                jlEnvPath = await jlpkgenv.getAbsEnvPath()
            } catch (e) {
                const msg = `Could not start the Julia language server because the current environment could not be determined. Check the \`julia.executablePath\` and \`julia.environmentPath\` settings for correctness.`
                this.outputChannel.appendLine(msg)
                this.outputChannel.appendLine(e)
                vscode.window.showErrorMessage(msg, 'Open Settings').then((val) => {
                    if (val) {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'julia.path')
                    }
                })
                this.statusBarItem.hide()
                return
            }
        }

        const storagePath = this.context.globalStorageUri.fsPath

        const serverArgsRun: string[] = [
            '--startup-file=no',
            '--history-file=no',
            '--depwarn=no',
            'main.jl',
            jlEnvPath,
            '--debug=no',
            telemetry.getCrashReportingPipename(),
            storagePath,
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
            storagePath,
            '--detached=no',
            juliaExecutable.command,
            juliaExecutable.version,
        ]
        const spawnOptions = {
            cwd: path.join(this.context.extensionPath, 'scripts', 'languageserver'),
            env: {
                ...getCustomEnvironmentVariables(),
                HOME: process.env.HOME ? process.env.HOME : os.homedir(),
                JULIA_LANGUAGESERVER: '1',
                JULIA_VSCODE_LANGUAGESERVER: '1',
                JULIA_VSCODE_INTERNAL: '1',
                PATH: process.env.PATH,
            },
        }

        let serverOptions: ServerOptions
        if (process.env.DETACHED_LS) {
            serverOptions = async () => {
                // eslint-disable-next-line no-async-promise-executor
                const p = new Promise<{ reader; writer; detached }>(async (resolve) => {
                    let isConnected = false
                    while (!isConnected) {
                        const conn = net.connect({ port: 7777 }, () => {
                            resolve({ reader: conn, writer: conn, detached: true })
                            isConnected = true
                        })
                        if (isConnected) {
                            return
                        }
                        await new Promise((resolve) => setTimeout(() => resolve(null), 1000))
                    }
                })
                return await p
            }
        } else {
            serverOptions = {
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

        // The default error handler restarts the server on a crash, unless it
        // crashed 5 times within the last 3 minutes. The wrapper records that
        // decision so the state change handler below can tell a transient
        // crash apart from a crash loop.
        const errorHandler = new RestartTrackingErrorHandler(() => languageClient.createDefaultErrorHandler())

        const clientOptions: LanguageClientOptions = {
            documentSelector: selector,
            revealOutputChannelOn: RevealOutputChannelOn.Never,
            traceOutputChannel: this.traceOutputChannel,
            outputChannel: this.outputChannel,
            initializationOptions: { julialangTestItemIdentification: true },
            errorHandler,
        }

        // Create the language client and start the client.
        const languageClient = new LanguageClient('julia', 'Julia Language Server', serverOptions, clientOptions)
        languageClient.registerProposedFeatures()

        languageClient.onDidChangeState((event: StateChangeEvent) => {
            switch (event.newState) {
                case State.Starting:
                    this.setState('starting')
                    break
                case State.Running:
                    this.setState('running')
                    break
                case State.Stopped:
                    if (this._intentionalStop) {
                        break
                    }
                    if (errorHandler.consumeRestartPending()) {
                        // The client restarts the server itself after a
                        // transient crash and reuses this client instance,
                        // so keep it around and wait for the Starting event.
                        this.setState('starting')
                    } else {
                        // The client has given up: the server entered a crash
                        // loop or shut down after repeated connection errors.
                        this.setState('crashed')
                        this.setLanguageClient()
                    }
                    break
            }
        })
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
                    data.spanId,
                    data.parentSpanId ?? undefined,
                    data.traceId,
                    data.name,
                    data.time,
                    data.duration,
                    data.attributes,
                    'Language Server'
                )
            } else if (data.command === 'trace_log') {
                telemetry.traceLog(
                    data.spanId,
                    data.parentSpanId ?? undefined,
                    data.traceId,
                    data.message,
                    data.severity,
                    data.time,
                    'Language Server',
                    data.attributes
                )
            }
        })

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

    async restartLanguageServer(envPath?: string, autoInstall?: boolean) {
        await this.stopLanguageServer()
        await this.startServer(envPath, autoInstall)
    }

    public async dispose(): Promise<void> {
        await this.stopLanguageServer()

        this.statusBarItem.dispose()
        this.outputChannel.dispose()
        this.traceOutputChannel.dispose()
    }
}
