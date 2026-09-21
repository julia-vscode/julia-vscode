import {
    ConnectionError,
    ConnectionErrors,
    ErrorCodes,
    LSPErrorCodes,
    ResponseError,
} from 'vscode-languageserver-protocol'

/**
 * Node error codes raised when the stdin pipe or socket of the language
 * server (or of the test item controller, whose connection fails the same
 * way) goes away underneath a pending write. `EOF` is what a write to a
 * closed pipe raises on Windows, where POSIX raises `EPIPE`.
 */
const teardownStreamCodes = new Set([
    'EPIPE',
    'EOF',
    'ECONNRESET',
    'ERR_STREAM_DESTROYED',
    'ERR_STREAM_WRITE_AFTER_END',
])

/**
 * The exact messages of the errors this module classifies, for the cases
 * where only the message survives.
 *
 * Errors that VS Code attributes to this extension (a rejected language
 * feature provider, an unhandled rejection inside the bundled
 * `vscode-jsonrpc`) reach `sendErrorData` as a freshly constructed plain
 * `Error` carrying only `name`, `message` and `stack`: the prototype and the
 * `code` property are stripped. Matching on the whole message, never a
 * substring, keeps this from masking genuine server errors that merely
 * mention a connection.
 */
const teardownMessages = new Set([
    // vscode-jsonrpc `connection.dispose()` rejecting every pending request
    'Pending response rejected since connection got disposed',
    // vscode-jsonrpc `throwIfClosedOrDisposed()` on a send after close
    'Connection is disposed.',
    'Connection is closed.',
    // vscode-languageclient `sendRequest`/`sendNotification` guard
    'Client is not running',
    // Node stream and socket failures, also wrapped as `MessageWriteError`
    'Cannot call write after a stream was destroyed',
    'write EPIPE',
    'write EOF',
    'This socket has been ended by the other party',
])

/**
 * Returns true if the error is a result of the language server connection
 * being unavailable: the server crashed, stopped or restarted while a
 * request, notification or cancellation was in flight, or the client was not
 * running when a call was made.
 *
 * Such errors are expected teardown noise. The server crash itself is
 * reported separately through the crash reporting pipe, so these must not
 * become extension crash reports; `telemetry.handleNewCrashReportFromException`
 * drops them, and `withLanguageClient` turns them into a graceful fallback.
 *
 * The test item controller's connection dies the same way, and its death is
 * likewise reported on its own, by the controller's crash logger and by
 * the exit handler in `testFeature.ts`, so a write that its exit strands
 * is classified here too rather than reported as a second crash.
 *
 * `vscode-languageclient`'s own `handleFailedRequest` already swallows the
 * `ResponseError` codes below for its built-in providers, but it logs and
 * rethrows everything else, notably a `ConnectionError` thrown between the
 * connection being disposed and the client state changing, and a
 * `MessageWriteError` wrapping a failed pipe write.
 */
export function isLanguageServerError(err: unknown): boolean {
    if (err instanceof ResponseError) {
        switch (err.code) {
            case ErrorCodes.PendingResponseRejected:
            case ErrorCodes.ConnectionInactive:
            case ErrorCodes.MessageWriteError:
            case LSPErrorCodes.RequestCancelled:
            case LSPErrorCodes.ServerCancelled:
            case LSPErrorCodes.ContentModified:
                return true
            default:
                return false
        }
    }
    if (err instanceof ConnectionError) {
        return err.code === ConnectionErrors.Disposed || err.code === ConnectionErrors.Closed
    }
    if (err instanceof Error) {
        const code = (err as Error & { code?: unknown }).code
        if (typeof code === 'string' && teardownStreamCodes.has(code)) {
            return true
        }
        if (teardownMessages.has(err.message)) {
            return true
        }
        // vscode-languageclient `shutdown()` called in a state other than
        // `Running`; the message ends with the current state.
        if (err.message.startsWith("Client is not running and can't be stopped")) {
            return true
        }
    }
    return false
}

/**
 * The error codes LanguageServer.jl answers a request with when it cannot
 * serve the document the request names. They are outside the LSP-reserved
 * ranges, so they only ever come from our own server.
 *
 * `-33100` is `nodocument_error` and `-33101` is `mismatched_version_error`,
 * both in LanguageServer.jl's `src/utilities.jl`.
 */
const JLS_NO_DOCUMENT = -33100
const JLS_VERSION_MISMATCH = -33101

/**
 * The whole messages of those same answers, for the copies that reach us
 * without their code, the way `teardownMessages` above does.
 *
 * Anchored at both ends, and the URI in the middle of each is matched as a run
 * of non-whitespace: a loose prefix such as `document ` would match far too
 * much, and a trailing `.+` would let anything follow the message as long as
 * it ended the right way. A URI the server prints is percent-encoded, so it
 * never contains a space; one that somehow did would fall out here and be
 * reported, which is the right way round to be wrong.
 */
const documentStateMessagePatterns = [
    // `nodocument_error`: the server never tracked this document, e.g. a
    // `git:` diff view or a buffer outside the workspace.
    /^document \S+ requested but not present in the JLS for request \S+$/,
    // `mismatched_version_error`: the edit the request is about has not
    // reached the server yet.
    /^version mismatch in \S+ request for \S+: JLS -?\d+, client: -?\d+$/,
    // `MissingDocumentError`, turned into LSP `InvalidParams` by
    // `invoke_handler` in LanguageServer.jl's `src/languageserverinstance.jl`.
    /^Document not available: \S+\.$/,
]

/**
 * Returns true for a language server answer that says it does not have the
 * document a request named, or does not have it at the version the request
 * was built against.
 *
 * Neither is a fault. The server deliberately does not track every buffer VS
 * Code will hand a provider or a REPL command — a `git:` diff view is the
 * common one — and a document version the server has not caught up with is
 * the ordinary state of an edit in flight. A caller that gets one of these
 * has no answer to work with and should fall back, not report a crash.
 */
export function isExpectedDocumentStateError(err: unknown): boolean {
    if (err instanceof ResponseError && (err.code === JLS_NO_DOCUMENT || err.code === JLS_VERSION_MISMATCH)) {
        return true
    }
    if (err instanceof Error) {
        return documentStateMessagePatterns.some((pattern) => pattern.test(err.message))
    }
    return false
}

/**
 * Message prefixes of language server response errors that must not become
 * extension crash reports. Like `teardownMessages` above, these arrive at
 * `sendErrorData` as rebuilt plain `Error`s without their `ResponseError`
 * code, so the message prefix is the only thing left to classify on.
 */
const responseNoisePrefixes = [
    // JSONRPC.jl wraps a failed request handler into this response and then
    // rethrows on the server, where the language server files its own crash
    // report with the full Julia backtrace through the crash pipe; the
    // client-side copy is a duplicate without one.
    'Error handling request: ',
    // LanguageServer.jl's `format_failure_error` (LSP RequestFailed): the
    // user asked to format a file that is not parseable Julia code, which is
    // their code's state, not a bug. vscode-languageclient already shows the
    // message as a notification before rethrowing.
    'Could not format ',
]

/**
 * Returns true for response errors of the language server that are expected
 * user conditions or that the server already reports itself, so an
 * extension-side crash report would be noise or a stackless duplicate.
 * `telemetry.handleNewCrashReportFromException` drops them alongside
 * {@link isLanguageServerError}.
 *
 * The document-state answers of {@link isExpectedDocumentStateError} count as
 * noise here too. A caller that knows what to fall back to should handle them
 * where they happen; this is the net for the paths that do not.
 */
export function isLanguageServerResponseNoise(err: unknown): boolean {
    if (!(err instanceof Error)) {
        return false
    }
    if (isExpectedDocumentStateError(err)) {
        return true
    }
    return responseNoisePrefixes.some((prefix) => err.message.startsWith(prefix))
}

/**
 * What a failed language server request was, in the terms that survive to
 * telemetry.
 *
 * A rejection nothing catches is handed to crash reporting by VS Code as a
 * freshly built plain `Error`: the `ResponseError` prototype and its `code`
 * are gone and the message is all that is left, which is why
 * {@link isLanguageServerResponseNoise} has to classify on message prefixes.
 * Telemetry currently carries such a report whose message is *only* a URL — it
 * sanitizes to `<REDACTED: URL>`, and no error site in LanguageServer.jl
 * produces a bare-URI message — so there is nothing in it to say which request
 * it belongs to, or even which of the connections it came from.
 *
 * `handleFailedRequest` sees the same failures while the method and the code
 * are still attached, and reports this description instead. It carries no
 * message text on purpose: method names and numeric codes are ours, whereas a
 * message can hold anything the user's workspace put in it.
 */
export function describeFailedRequest(method: string, err: unknown): { [key: string]: string } {
    const code = err instanceof ResponseError ? String(err.code) : 'none'
    const type = err instanceof Error ? (err.constructor?.name ?? err.name) : typeof err
    return { method, code, type }
}

/**
 * The one-line form of {@link describeFailedRequest} for the output channel,
 * where a user looking into "why did that do nothing" already goes.
 */
export function formatFailedRequest(description: { [key: string]: string }): string {
    return `Request '${description.method}' failed: ${description.type}, code ${description.code}`
}
