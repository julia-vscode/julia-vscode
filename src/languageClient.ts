import { ChildProcess } from 'child_process'
import * as fs from 'fs'
import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import {
    CancellationToken,
    CloseAction,
    CloseHandlerResult,
    ErrorHandler,
    ErrorHandlerResult,
    LanguageClient,
    LanguageClientOptions,
    Message,
    MessageSignature,
    MessageTransports,
    ProtocolRequestType,
    ProtocolRequestType0,
    RequestParam,
    RequestType,
    RequestType0,
    RevealOutputChannelOn,
    ServerOptions,
    State,
    StateChangeEvent,
} from 'vscode-languageclient/node'
import { ResponseError } from 'vscode-languageserver-protocol'

import * as jlpkgenv from './jlpkgenv'
import {
    describeFailedRequest,
    formatFailedRequest,
    isLanguageServerError,
    isLanguageServerResponseNoise,
    tagDocumentStateError,
} from './languageServerErrors'
import * as telemetry from './telemetry'
import { ExecutableFeature, JuliaExecutable, JuliaNotFoundError } from './executables'
import { getCustomEnvironmentVariables, onEvent, registerCommand } from './utils'
import { osKillNotification, osKillReport } from './processExit'

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
    private restarts: number = 0

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
            this.restarts += 1
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

    /** How many times the server has been auto-restarted after a crash. */
    get restartCount(): number {
        return this.restarts
    }
}

/**
 * Whether `position` names a line the document does not have.
 *
 * `document.validatePosition` is VS Code's own authority on what is addressable
 * in the document, so this asks it rather than reimplementing the line model.
 * Only the line component is compared: the language server clamps a character
 * that runs past the end of its line, and it is only an out-of-range *line* that
 * makes `index_at` throw (`LanguageServer/src/textdocument.jl`, `line >=
 * length(line_indices) || line < 0`). The two sides agree on what a line is —
 * `JuliaWorkspaces._compute_line_indices` splits on `\n`, `\r\n` and a lone `\r`
 * exactly as VS Code's text model does — so this predicate is precisely the
 * server's crash condition, evaluated one process earlier.
 */
function hasUnaddressableLine(document: vscode.TextDocument, position: vscode.Position): boolean {
    return document.validatePosition(position).line !== position.line
}

/**
 * How far out of range a position is, for telemetry. Carries no path and no
 * document content — a line number and the document's line count, the same two
 * numbers the server's own `LSOffsetError` reports, so the two sides can be
 * compared directly. `vscode.Position` rejects a negative line in its
 * constructor, so this is always a line past the end.
 */
function describeUnaddressableLine(document: vscode.TextDocument, position: vscode.Position): string {
    return `line=${position.line} line_count=${document.lineCount}`
}

/**
 * Drops language feature requests whose position VS Code itself would reject
 * before they reach the server.
 *
 * Nothing in the pipeline validates a provider position: VS Code's
 * `ExtHostLanguageFeatures` adapters hand it to the provider untouched, and
 * `code2ProtocolConverter.asTextDocumentPositionParams` converts it verbatim. So
 * anyone calling e.g. `vscode.executeCompletionItemProvider` with an arbitrary
 * position — a third-party extension, or our own code with a
 * `new Position(document.lineCount, 0)` meant as "end of document" — sends that
 * position straight through to the language server, where `index_at` throws
 * `LSOffsetError` and the request dies as a crash report.
 *
 * This is the middleware route dbaeumer pointed at in
 * microsoft/vscode-languageserver-node#637 and
 * microsoft/language-server-protocol#946: the client libraries cannot guard in
 * general (the protocol allows requests for documents that are not open), but an
 * extension that knows its documents are open can. julia-vscode#1333 shipped it
 * as a telemetry probe in 2020; it was removed in f1dd157bd before it ever
 * answered the question. Here it both drops the request and counts it.
 *
 * Nothing about the messages we do send changes — an invalid request is simply
 * not sent, and the provider reports no result, which is what the server would
 * have had to answer anyway.
 *
 * What this deliberately does *not* cover is a position that is addressable in
 * VS Code's copy of the document but not in the server's. That means the two
 * sides disagree about the document, and the desync stays loud on the server so
 * it can still be diagnosed; see the `LSOffsetError` handling in
 * `LanguageServer/src/languageserverinstance.jl`.
 */
export class PositionValidationGuard {
    /**
     * @param report Called once per dropped request with the provider's name and
     *               a description of how far out of range the position was.
     */
    constructor(private report: (provider: string, detail: string) => void) {}

    /**
     * Returns true — and reports — when `positions` contains a line the document
     * does not have, meaning the request must not be forwarded.
     */
    private shouldDrop(
        provider: string,
        document: vscode.TextDocument,
        positions: readonly vscode.Position[]
    ): boolean {
        const invalid = positions.find((position) => hasUnaddressableLine(document, position))
        if (invalid === undefined) {
            return false
        }
        this.report(provider, describeUnaddressableLine(document, invalid))
        return true
    }

    /**
     * Wraps a provider that takes a single position. `next` is not called when
     * the position is out of range; the provider reports no result instead.
     */
    at<T>(
        provider: string,
        document: vscode.TextDocument,
        position: vscode.Position,
        next: () => vscode.ProviderResult<T>
    ): vscode.ProviderResult<T> {
        return this.shouldDrop(provider, document, [position]) ? undefined : next()
    }

    /**
     * As {@link at}, for providers that take several positions or a range. The
     * whole request is dropped if any of them is out of range: a range with one
     * unaddressable end does not describe a region of this document.
     */
    atAll<T>(
        provider: string,
        document: vscode.TextDocument,
        positions: readonly vscode.Position[],
        next: () => vscode.ProviderResult<T>
    ): vscode.ProviderResult<T> {
        return this.shouldDrop(provider, document, positions) ? undefined : next()
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
 * Windows exit codes of a process terminated by the OS rather than by
 * anything the process did itself, seen in bursts when a session ends: the
 * running process is killed with DBG_TERMINATE_PROCESS (0x40010004), and
 * immediate restart attempts then fail with STATUS_DLL_INIT_FAILED
 * (0xC0000142) because no new process can initialise in a session that is
 * shutting down. Neither can be produced by Julia or extension code, Julia
 * never ran (or was stopped mid-instruction), and the accompanying stderr
 * is empty, so a report of such an exit has no crash information to carry.
 */
export function isEnvironmentalWindowsExitCode(code: number | null): boolean {
    return code === 0x40010004 || code === 0xc0000142
}

/**
 * Signals that mean something outside the process tree killed the language
 * server: an out-of-memory killer (the kernel's or a cgroup's), a container
 * stop, a session teardown, a `kill -9`.
 *
 * Neither Julia nor this extension sends these. An extension-initiated stop
 * goes through the graceful shutdown path and sets `_intentionalStop`, which
 * `unexpectedServerExit` filters out, and a Julia-level crash exits with code
 * 1 after reporting itself through the crash pipe. So a kill signal reaching
 * the exit handler is a condition of the user's machine, not a defect here,
 * and it carries no stack and nothing to fix.
 *
 * `SIGSEGV`, `SIGBUS`, `SIGILL` and `SIGABRT` are deliberately not included:
 * those are genuine native crashes in Julia or a library it loads, and stay
 * crash reports.
 */
export function isExternalKillSignal(signal: NodeJS.Signals | null): boolean {
    return signal === 'SIGKILL' || signal === 'SIGTERM'
}

/**
 * The one of those kills that is worth a crash report of its own.
 *
 * Only `SIGKILL`. Running out of memory is the single cause here that can be a
 * leak of ours rather than a fact about the user's machine, and it always
 * arrives as `SIGKILL`: neither the kernel's out-of-memory killer nor a
 * cgroup's asks politely first. `SIGTERM` is what a person, a session manager,
 * a container stop or an editor shutting down sends. Telemetry had those
 * arriving in bursts from remote sessions on a host with 438 GiB of 503 GiB
 * free — no memory pressure anywhere in sight — which buried the case this
 * report exists for in teardown noise.
 *
 * A `SIGTERM` still is not an unexpected exit either: `isExternalKillSignal`
 * keeps it out of `unexpectedServerExit`, so it is logged and counted rather
 * than reported.
 */
export function isReportableOsKill(signal: NodeJS.Signals | null): boolean {
    return signal === 'SIGKILL'
}

/**
 * Parses the contents of a cgroup memory limit file. Returns `null` when no
 * limit is set, which cgroup v2 writes as `max` and cgroup v1 as a sentinel
 * near the word size.
 */
export function parseCgroupMemoryLimit(contents: string): number | null {
    const trimmed = contents.trim()
    if (trimmed === '' || trimmed === 'max') {
        return null
    }
    const limit = Number(trimmed)
    // The v1 sentinel is far too large to be a safe integer, so it falls out
    // here along with anything unparsable.
    if (!Number.isSafeInteger(limit) || limit <= 0) {
        return null
    }
    return limit
}

/**
 * The memory limit this process is actually held to, which on a container is
 * far below the machine's total and is what an OOM killer acts on. `null` off
 * Linux, or when neither cgroup file can be read.
 */
export function readCgroupMemoryLimit(): number | null {
    for (const file of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
        try {
            const limit = parseCgroupMemoryLimit(fs.readFileSync(file, 'utf8'))
            if (limit !== null) {
                return limit
            }
        } catch {
            // Not this cgroup version, or not Linux at all.
        }
    }
    return null
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
 * Julia code, or ran it outside the guarded block: a native crash such as a
 * `SIGSEGV`, or the runtime's own exit codes. Those leave no trace anywhere
 * else.
 * Exits forced from outside the process tree are the other exception, and are
 * not crashes at all: see `isEnvironmentalWindowsExitCode` for the Windows
 * session-teardown codes and `isExternalKillSignal` for kill signals, the
 * latter counted as an `lsoskill` event in `observeServerProcess` instead, and
 * reported there only for the `SIGKILL` that `isReportableOsKill` singles out.
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
    if (isEnvironmentalWindowsExitCode(code) || isExternalKillSignal(signal)) {
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
 *
 * It also watches the requests going through it, see `sendRequest` and
 * `handleFailedRequest` below.
 */
export class ObservedLanguageClient extends LanguageClient {
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

    /**
     * Every request of this client goes out through here: our own custom
     * requests and those of `vscode-languageclient`'s built-in features alike,
     * which all call `client.sendRequest`.
     *
     * A document-state answer of the server is given
     * `DOCUMENT_STATE_ERROR_NAME` on its way back out, while its code is still
     * attached, so crash reporting can still recognise it after VS Code has
     * rebuilt it with a cleaned message — see `tagDocumentStateError`. The
     * error itself is rethrown unchanged otherwise.
     */
    public override sendRequest<R, PR, E, RO>(
        type: ProtocolRequestType0<R, PR, E, RO>,
        token?: CancellationToken
    ): Promise<R>
    public override sendRequest<P, R, PR, E, RO>(
        type: ProtocolRequestType<P, R, PR, E, RO>,
        params: NoInfer<RequestParam<P>>,
        token?: CancellationToken
    ): Promise<R>
    public override sendRequest<R, E>(type: RequestType0<R, E>, token?: CancellationToken): Promise<R>
    public override sendRequest<P, R, E>(
        type: RequestType<P, R, E>,
        params: NoInfer<RequestParam<P>>,
        token?: CancellationToken
    ): Promise<R>
    public override sendRequest<R>(method: string, token?: CancellationToken): Promise<R>
    public override sendRequest<R>(method: string, param: unknown, token?: CancellationToken): Promise<R>
    public override async sendRequest<R>(type: string | MessageSignature, ...params: unknown[]): Promise<R> {
        try {
            // The base class sorts `params` into a parameter and a token
            // itself; only the overloads need convincing.
            return await super.sendRequest<R>(type as string, ...(params as [unknown, CancellationToken?]))
        } catch (err) {
            throw tagDocumentStateError(err)
        }
    }

    /**
     * Every failed request of this client passes through here, with the
     * request type still attached and the error still a `ResponseError`
     * carrying its code. Both are gone by the time a rejection nothing catches
     * reaches crash reporting, which is why an unexplained response error is
     * currently unattributable — see `describeFailedRequest`.
     *
     * So this records what the failure was, and changes nothing about what
     * happens to it: the base class still decides whether to swallow, notify
     * or rethrow. Failures already classified as teardown noise or as an
     * expected user condition are left alone, since those are understood and
     * arrive in the thousands.
     */
    public override handleFailedRequest<T>(
        type: MessageSignature,
        token: CancellationToken | undefined,
        error: unknown,
        defaultValue: T,
        showNotification?: boolean,
        throwOnCancel?: boolean
    ): T {
        if (!isLanguageServerError(error) && !isLanguageServerResponseNoise(error)) {
            const description = describeFailedRequest(type.method, error)
            this.outputChannel.appendLine(formatFailedRequest(description))
            telemetry.traceEvent('lsrequestfailed', description)
        }
        return super.handleFailedRequest(type, token, error, defaultValue, showNotification, throwOnCancel)
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
            // A kill nobody here asked for gets its own report rather than the
            // bare exit line `unexpectedServerExit` produces. The server is ours
            // and it is the long-lived process of this extension, so a kill for
            // running out of memory can be a leak on our side rather than the
            // machine being short — and only the figures below tell those apart.
            // The `_intentionalStop` check matters: our own shutdown path can
            // end in a SIGTERM.
            //
            // Both kill signals are logged and counted, but only the `SIGKILL`
            // of `isReportableOsKill` is reported and shown: a `SIGTERM` here
            // is somebody else's teardown, not a memory problem of ours.
            if (!this._intentionalStop && isExternalKillSignal(signal)) {
                const limit = readCgroupMemoryLimit()
                const report = osKillReport(
                    'Julia language server',
                    signal,
                    { total: os.totalmem(), free: os.freemem(), cgroupLimit: limit },
                    [
                        `Julia: ${juliaExecutable.command} (${juliaExecutable.version})`,
                        '',
                        'Last stderr output:',
                        stderrTail.text(),
                    ]
                )

                this.outputChannel.appendLine(report)
                telemetry.traceEvent('lsoskill', {
                    signal,
                    totalmem: String(os.totalmem()),
                    freemem: String(os.freemem()),
                    cgrouplimit: limit === null ? 'none' : String(limit),
                })
                if (isReportableOsKill(signal)) {
                    telemetry.handleNewCrashReport(
                        'LanguageServerOsKill',
                        sanitizeHomeDir(report),
                        '',
                        'Language Server'
                    )

                    vscode.window
                        .showErrorMessage(
                            `${osKillNotification('The Julia language server', signal)} It will be restarted.`,
                            'Open Logs'
                        )
                        .then((choice) => {
                            if (choice === 'Open Logs') {
                                this.outputChannel.show()
                            }
                        })
                }
            }
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
        // The server derives its symbol store location from this path. Telemetry
        // has shown it arriving there malformed, with no way to see what the
        // client actually passed, so record it in the log users are asked for.
        this.outputChannel.appendLine(`Storage path for the language server: ${storagePath}`)

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
        const positionGuard = new PositionValidationGuard((provider, detail) =>
            telemetry.traceEvent('lsinvalidposition', { provider, detail })
        )

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
            //
            // A function, not an object: it is evaluated on every (re)start, so
            // `julialangRestartCount` reflects how many times this client has
            // auto-restarted the crashed server. The server stamps it into its
            // lifecycle crash reports so a desync can be tied to a restart.
            initializationOptions: () => ({
                julialangTestItemIdentification: true,
                julialangDirectoryWatching: 'on',
                // Ask for julia/publishServerStatus notifications, which feed
                // the Julia status bar item's flyout (statusBarFeature.ts).
                julialangServerStatus: true,
                julialangRestartCount: errorHandler.restartCount,
            }),
            errorHandler,
            middleware: {
                // The Julia status bar item (statusBarFeature.ts) already shows
                // the server's startup/indexing activity, so the $/progress
                // reports the server also sends would render the same
                // information a second time in the status bar. Swallow them.
                handleWorkDoneProgress: () => {},
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
                // Never ask the server about a line the document does not have
                // (see PositionValidationGuard). One hook per request the server
                // answers by indexing the position strictly; `provideInlayHints`
                // is deliberately absent, because the server already clamps that
                // viewport-derived range on purpose.
                provideCompletionItem: (document, position, context, token, next) =>
                    positionGuard.at('completion', document, position, () => next(document, position, context, token)),
                provideHover: (document, position, token, next) =>
                    positionGuard.at('hover', document, position, () => next(document, position, token)),
                provideSignatureHelp: (document, position, context, token, next) =>
                    positionGuard.at('signatureHelp', document, position, () =>
                        next(document, position, context, token)
                    ),
                provideDefinition: (document, position, token, next) =>
                    positionGuard.at('definition', document, position, () => next(document, position, token)),
                provideReferences: (document, position, options, token, next) =>
                    positionGuard.at('references', document, position, () => next(document, position, options, token)),
                provideDocumentHighlights: (document, position, token, next) =>
                    positionGuard.at('documentHighlight', document, position, () => next(document, position, token)),
                prepareRename: (document, position, token, next) =>
                    positionGuard.at('prepareRename', document, position, () => next(document, position, token)),
                provideRenameEdits: (document, position, newName, token, next) =>
                    positionGuard.at('rename', document, position, () => next(document, position, newName, token)),
                provideSelectionRanges: (document, positions, token, next) =>
                    positionGuard.atAll('selectionRange', document, positions, () => next(document, positions, token)),
                provideCodeActions: (document, range, context, token, next) =>
                    positionGuard.atAll('codeAction', document, [range.start, range.end], () =>
                        next(document, range, context, token)
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
