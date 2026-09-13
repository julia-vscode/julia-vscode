import { ChildProcess } from 'child_process'
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
    MessageTransports,
    RevealOutputChannelOn,
    ServerOptions,
    State,
    StateChangeEvent,
} from 'vscode-languageclient/node'
import { ResponseError } from 'vscode-languageserver-protocol'

import * as jlpkgenv from './jlpkgenv'
import { isLanguageServerError } from './languageServerErrors'
import * as telemetry from './telemetry'
import { ExecutableFeature, JuliaExecutable, JuliaNotFoundError } from './executables'
import { getCustomEnvironmentVariables, onEvent, registerCommand } from './utils'

export const supportedSchemes = ['file', 'untitled', 'vscode-notebook-cell']
const supportedLanguages = ['julia', 'juliamarkdown', 'markdown']

export type LanguageServerState = 'stopped' | 'starting' | 'running' | 'crashed'

/**
 * LSP 3.17 `ErrorCodes.RequestFailed`. `vscode-languageserver-protocol` does not
 * export a constant for it.
 */
const LSP_REQUEST_FAILED = -32803

/**
 * The last formatting failure reported for a document, so that format-on-save on
 * a file with a syntax error warns once rather than on every keystroke-save
 * cycle. Cleared when the document formats successfully, so a file that is fixed
 * and then broken again warns again.
 */
const lastFormattingFailure = new Map<string, string>()

/**
 * Turn a failed formatting request into a message for the user instead of an
 * extension fault.
 *
 * `vscode-languageclient`'s `handleFailedRequest` only swallows a small set of
 * codes (`PendingResponseRejected`, `ConnectionInactive`, `RequestCancelled`,
 * `ServerCancelled`, `ContentModified`); every other error — including
 * `RequestFailed`, which is precisely the code a server is supposed to use for
 * "understood, but I can't do that" — is logged and then **rethrown**. The
 * rethrow lands in VS Code's format command, which attributes it to this
 * extension and reports it as a crash. So the server cannot fix this on its own
 * no matter which code it picks; the client has to intercept.
 *
 * The overwhelmingly common cause is a file that isn't valid Julia, which is the
 * user's code rather than a bug, so we surface it as a warning and return `null`
 * ("no edits").
 */
function handleFormattingError<T>(
    outputChannel: vscode.OutputChannel,
    document: vscode.TextDocument,
    run: () => Promise<T>
): Promise<T | null> {
    const key = document.uri.toString()
    return run().then(
        (result) => {
            lastFormattingFailure.delete(key)
            return result
        },
        (err) => {
            if (err instanceof ResponseError) {
                outputChannel.appendLine(`Formatting failed: ${err.message}`)
                if (isLanguageServerError(err)) {
                    // The server went away mid-request; the crash, if any, is
                    // reported separately.
                    return null
                }
                // `RequestFailed` carries a message written for the user.
                // Anything else is still a failed formatting request, and the
                // user is better served by being told than by an error report,
                // so show what we have and keep the detail in the log. A server
                // error must never surface as an extension fault.
                const summary =
                    err.code === LSP_REQUEST_FAILED
                        ? err.message.split('\n')[0]
                        : `Could not format this document: ${err.message.split('\n')[0]}`
                if (lastFormattingFailure.get(key) !== summary) {
                    lastFormattingFailure.set(key, summary)
                    vscode.window.showWarningMessage(summary, 'Open Logs').then((choice) => {
                        if (choice === 'Open Logs') {
                            vscode.commands.executeCommand('language-julia.showLanguageServerOutput')
                        }
                    })
                }
                return null
            }
            throw err
        }
    )
}

function formatErrorForOutput(err: unknown): string {
    if (err instanceof Error) {
        return err.stack ?? err.message
    }
    return String(err)
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

/**
 * vscode-languageclient 10 requires a `LogOutputChannel` for its output channel
 * and pipes the server process's stderr through `outputChannel.error(...)`,
 * which stamps every line with a timestamp and `[error]`. The Julia language
 * server writes ordinary progress output to stderr, so that is both noisy and
 * misleading. This satisfies the `LogOutputChannel` interface but is backed by
 * a plain output channel, forwarding every log level to a verbatim
 * `appendLine`.
 */
class RawLogOutputChannel implements vscode.LogOutputChannel {
    private readonly channel: vscode.OutputChannel
    private readonly logLevelEmitter = new vscode.EventEmitter<vscode.LogLevel>()

    constructor(name: string) {
        this.channel = vscode.window.createOutputChannel(name)
    }

    get name(): string {
        return this.channel.name
    }

    // Nothing here filters by level -- every message is written verbatim -- but
    // the client copies this into its trace level, so report the same default
    // it uses when no channel is supplied rather than Trace, which would turn
    // protocol tracing on.
    get logLevel(): vscode.LogLevel {
        return vscode.LogLevel.Info
    }

    get onDidChangeLogLevel(): vscode.Event<vscode.LogLevel> {
        return this.logLevelEmitter.event
    }

    append(value: string): void {
        this.channel.append(value)
    }

    appendLine(value: string): void {
        this.channel.appendLine(value)
    }

    replace(value: string): void {
        this.channel.replace(value)
    }

    clear(): void {
        this.channel.clear()
    }

    show(preserveFocus?: boolean): void
    show(column?: vscode.ViewColumn, preserveFocus?: boolean): void
    show(columnOrPreserveFocus?: vscode.ViewColumn | boolean, preserveFocus?: boolean): void {
        if (typeof columnOrPreserveFocus === 'number') {
            this.channel.show(columnOrPreserveFocus, preserveFocus)
        } else {
            this.channel.show(columnOrPreserveFocus)
        }
    }

    hide(): void {
        this.channel.hide()
    }

    trace(message: string, ...args: unknown[]): void {
        this.write(message, args)
    }

    debug(message: string, ...args: unknown[]): void {
        this.write(message, args)
    }

    info(message: string, ...args: unknown[]): void {
        this.write(message, args)
    }

    warn(message: string, ...args: unknown[]): void {
        this.write(message, args)
    }

    error(error: string | Error, ...args: unknown[]): void {
        this.write(error instanceof Error ? (error.stack ?? error.message) : error, args)
    }

    private write(message: string, args: unknown[]): void {
        this.channel.appendLine(args.length > 0 ? `${message} ${args.map((arg) => String(arg)).join(' ')}` : message)
    }

    dispose(): void {
        this.logLevelEmitter.dispose()
        this.channel.dispose()
    }
}

/**
 * Decides whether a language server process exit is worth a crash report.
 * Returns `null` for an expected exit, otherwise a one-line description.
 *
 * Code 1 is skipped on purpose: the Julia side's `global_err_handler`
 * (`scripts/error_handler.jl`) writes its own crash report to the pipe and
 * then calls `exit(1)`, so reporting that exit here would file every Julia
 * crash twice. The same convention is used for the test item controller in
 * `testFeature.ts`. What that path cannot cover is a death that never ran
 * Julia code, or ran it outside the guarded block: a signal, a native crash,
 * an out-of-memory kill, or the runtime's own exit codes. Those leave no
 * trace anywhere else.
 */
export function unexpectedServerExit(
    code: number | null,
    signal: NodeJS.Signals | null,
    intentionalStop: boolean
): string | null {
    if (intentionalStop) {
        return null
    }
    if (signal === null && (code === 0 || code === 1)) {
        return null
    }
    return `Julia language server process exited with code ${code ?? 'none'}, signal ${signal ?? 'none'}`
}

/**
 * Keeps the last `limit` characters written to a stream, so that the tail
 * of the language server's stderr can accompany an exit report.
 */
export class StderrTail {
    private buffer = ''

    constructor(private limit: number = 4096) {}

    append(chunk: Buffer | string): void {
        this.buffer += chunk.toString()
        if (this.buffer.length > this.limit) {
            this.buffer = this.buffer.slice(this.buffer.length - this.limit)
        }
    }

    text(): string {
        return this.buffer
    }
}

/**
 * Replaces the user's home directory with `~`, in the spirit of the path
 * sanitising `error_handler.jl` applies to Julia stack traces.
 */
export function sanitizeHomeDir(text: string, homeDir: string = os.homedir()): string {
    if (!homeDir) {
        return text
    }
    const variants = new Set([homeDir, homeDir.replace(/\\/g, '/'), homeDir.replace(/\//g, '\\')])
    let result = text
    for (const variant of variants) {
        const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        result = result.replace(new RegExp(escaped, process.platform === 'win32' ? 'gi' : 'g'), '~')
    }
    return result
}

/**
 * A `LanguageClient` that hands the freshly spawned server process to a
 * callback. `serverProcess` is set inside `createMessageTransports`, before
 * the `initialize` request goes out, and is cleared again the moment the
 * connection closes, so this is the one place to attach `exit` and stderr
 * listeners that also see a death during startup. Everything else (the
 * spawn itself, debug-mode selection, killing the process on stop) stays
 * with the client.
 */
class ObservedLanguageClient extends LanguageClient {
    constructor(
        id: string,
        name: string,
        serverOptions: ServerOptions,
        clientOptions: LanguageClientOptions,
        private onServerProcess: (serverProcess: ChildProcess) => void
    ) {
        super(id, name, serverOptions, clientOptions)
    }

    protected override async createMessageTransports(encoding: string): Promise<MessageTransports> {
        const transports = await super.createMessageTransports(encoding)
        const serverProcess = this.serverProcess
        if (serverProcess) {
            this.onServerProcess(serverProcess)
        }
        return transports
    }
}

export class LanguageClientFeature {
    private onDidSetLanguageClientEmitter = new vscode.EventEmitter<LanguageClient | null>()
    public onDidSetLanguageClient = this.onDidSetLanguageClientEmitter.event

    private onDidChangeConfigEmitter = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>()
    public onDidChangeConfig = this.onDidChangeConfigEmitter.event

    private _onDidChangeStateEmitter = new vscode.EventEmitter<LanguageServerState>()
    public onDidChangeLsState = this._onDidChangeStateEmitter.event

    // The language server just writes plain text to stderr, so this channel is
    // a shim that strips the timestamp and `[error]` prefix that
    // vscode-languageclient 10 would otherwise add to every line.
    private outputChannel: vscode.LogOutputChannel = new RawLogOutputChannel('Julia Language Server')
    // The trace channel stays a real log channel: the client reads its
    // `logLevel` and `onDidChangeLogLevel` to decide whether LSP tracing is on,
    // and timestamped protocol messages are what we want there anyway.
    private traceOutputChannel: vscode.LogOutputChannel = vscode.window.createOutputChannel(
        'Julia Language Server Trace',
        { log: true }
    )

    private serverStarting: boolean = false

    private _state: LanguageServerState = 'stopped'
    private _intentionalStop: boolean = false

    languageClient: LanguageClient | null = null

    public get state(): LanguageServerState {
        return this._state
    }

    private setState(state: LanguageServerState) {
        if (this._state !== state) {
            this._state = state
            this._onDidChangeStateEmitter.fire(state)
        }
    }

    private async stopLanguageServer() {
        this._intentionalStop = true
        const languageClient = this.languageClient
        if (languageClient) {
            try {
                await languageClient.stop()
            } catch (err) {
                console.debug(`Stopping the language server failed: ${err}`)
            }
        }
        this.setState('stopped')
        if (languageClient) {
            this.setLanguageClient()
        }
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
        if (this._state !== 'running' || !this.languageClient) {
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
            // `withLanguageClient` already absorbs language-server teardown
            // errors, so whatever lands here is an extension bug.
            telemetry.handleNewCrashReportFromException(err, 'Extension')
            this.outputChannel.appendLine(`Could not notify the language server of the environment change: ${err}`)
        }
    }

    /**
     * Reports a language server process that died without the Julia side
     * having reported it, see `unexpectedServerExit`.
     */
    private observeServerProcess(serverProcess: ChildProcess, juliaExecutable: JuliaExecutable) {
        const stderrTail = new StderrTail()
        serverProcess.stderr?.on('data', (chunk) => stderrTail.append(chunk))
        serverProcess.on('exit', (code, signal) => {
            const reason = unexpectedServerExit(code, signal, this._intentionalStop)
            if (reason === null) {
                return
            }
            telemetry.traceEvent('lsprocessexit')
            const message = [
                reason,
                `Julia: ${juliaExecutable.command} (${juliaExecutable.version})`,
                '',
                'Last stderr output:',
                stderrTail.text(),
            ].join('\n')
            telemetry.handleNewCrashReport('LanguageServerProcessExit', sanitizeHomeDir(message), '', 'Language Server')
        })
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

        // Report 'starting' right away: executable and environment resolution
        // below can take a while, and the language client only fires its own
        // Starting event once the server process actually launches. The status
        // bar feature renders this as a spinner.
        this.setState('starting')

        let juliaExecutable: JuliaExecutable

        try {
            juliaExecutable = await this.executable.getLsExecutable(autoInstall)
        } catch (err) {
            this.setState('stopped')
            if (err instanceof JuliaNotFoundError) {
                // No usable Julia for the language server; the user has already
                // been informed through the status bar and output channel.
                return
            }
            throw err
        }

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
                this.setState('stopped')
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
            // julialangDirectoryWatching: the VS Code watcher reports an atomic
            // folder rename/delete as a single folder-path event, so the LS
            // registers an extra `**` create/delete watcher. Passing 'on'
            // explicitly makes that apply in every Code-OSS fork, whatever
            // clientInfo.name it reports.
            initializationOptions: {
                julialangTestItemIdentification: true,
                julialangDirectoryWatching: 'on',
                // Ask for julia/publishServerStatus notifications, which feed
                // the Julia status bar item's flyout (statusBarFeature.ts).
                julialangServerStatus: true,
            },
            errorHandler,
            middleware: {
                // A formatting request that fails is a message for the user, not
                // an extension fault. See `handleFormattingError`.
                provideDocumentFormattingEdits: (document, options, token, next) =>
                    handleFormattingError(this.outputChannel, document, () =>
                        Promise.resolve(next(document, options, token))
                    ),
                provideDocumentRangeFormattingEdits: (document, range, options, token, next) =>
                    handleFormattingError(this.outputChannel, document, () =>
                        Promise.resolve(next(document, range, options, token))
                    ),
            },
        }

        // Create the language client and start the client.
        const languageClient = new ObservedLanguageClient(
            'julia',
            'Julia Language Server',
            serverOptions,
            clientOptions,
            (serverProcess) => this.observeServerProcess(serverProcess, juliaExecutable)
        )
        languageClient.registerProposedFeatures()

        languageClient.onDidChangeState((event: StateChangeEvent) => {
            switch (event.newState) {
                case State.Starting:
                    this.setState('starting')
                    break
                case State.Running:
                    this.setLanguageClient(languageClient)
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
                        telemetry.traceEvent('lscrashloop')
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

        let startupCleanupError: unknown
        const originalStop = languageClient.stop
        languageClient.stop = async (...args) => {
            try {
                return await originalStop.apply(languageClient, args)
            } catch (err) {
                startupCleanupError = err
            }
        }

        try {
            await languageClient.start()
        } catch (err) {
            telemetry.traceEvent('lsstartfailed')
            this.outputChannel.appendLine('Could not start the Julia language server.')
            this.outputChannel.appendLine(formatErrorForOutput(err))
            if (startupCleanupError && !isLanguageServerError(startupCleanupError)) {
                this.outputChannel.appendLine('The language client also failed while cleaning up the failed start.')
                this.outputChannel.appendLine(formatErrorForOutput(startupCleanupError))
            }
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
            this.setState('crashed')
            this.setLanguageClient()
        } finally {
            languageClient.stop = originalStop
        }
    }

    async restartLanguageServer(envPath?: string, autoInstall?: boolean) {
        await this.stopLanguageServer()
        await this.startServer(envPath, autoInstall)
    }

    public async dispose(): Promise<void> {
        await this.stopLanguageServer()

        this.outputChannel.dispose()
        this.traceOutputChannel.dispose()
    }
}
