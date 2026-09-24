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
 * `Error`. VS Code's telemetry logger copies `name`, `message` and `stack`,
 * runs its PII cleaning over each (see {@link DOCUMENT_STATE_ERROR_NAME})
 * and builds a new `Error` from the result, so the prototype and the `code`
 * property are gone. None of the messages below holds a path or a URL, so
 * the cleaning leaves them as they are. Matching on the whole message, never
 * a substring, keeps this from masking genuine server errors that merely
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
 * `MissingDocumentError`, which `invoke_handler` in LanguageServer.jl's
 * `src/languageserverinstance.jl` answers with as LSP `InvalidParams`. That
 * code is generic, so only this message makes it a document-state answer.
 */
const missingDocumentPattern = /^Document not available: \S+\.$/

/**
 * The whole messages of the document-state answers, as they read when they
 * leave the server.
 *
 * Anchored at both ends, and the URI in the middle of each is matched as a run
 * of non-whitespace: a loose prefix such as `document ` would match far too
 * much, and a trailing `.+` would let anything follow the message as long as
 * it ended the right way. A URI the server prints is percent-encoded, so it
 * never contains a space.
 *
 * These are no longer how such an answer is recognised once it has lost its
 * code; {@link DOCUMENT_STATE_ERROR_NAME} is. VS Code's cleaning rewrites
 * exactly these messages, because each of them carries a URI. They stay as a
 * best-effort net for a copy that reaches crash reporting without having
 * passed through our language client, and so without the name, and whose URI
 * the cleaning happened to leave alone (`untitled:Untitled-1`, say).
 */
const documentStateMessagePatterns = [
    // `nodocument_error`: the server never tracked this document, e.g. a
    // `git:` diff view or a buffer outside the workspace.
    /^document \S+ requested but not present in the JLS for request \S+$/,
    // `mismatched_version_error`: the edit the request is about has not
    // reached the server yet.
    /^version mismatch in \S+ request for \S+: JLS -?\d+, client: -?\d+$/,
    missingDocumentPattern,
]

/**
 * The `name` our language client gives an error the server answered a
 * request with when that answer is one of
 * {@link isExpectedDocumentStateError}'s, see {@link tagDocumentStateError}.
 *
 * It exists because the answer is unrecognisable by the time it reaches crash
 * reporting otherwise. A rejection nothing catches reaches `sendErrorData`
 * through VS Code's telemetry logger, which does not hand over the error it
 * was given: it copies `name`, `message` and `stack`, cleans each copy, and
 * builds a new plain `Error` from the result, so the `ResponseError` prototype
 * and the code are gone and the message is the cleaned one. The cleaning
 * turns every `%20` into a space, replaces anything shaped like a file path
 * with `<REDACTED: user-file-path>`, and replaces a single-line value that
 * contains a URL (`scheme://…`) *whole* with `<REDACTED: URL>`. Every one of
 * the server's document-state messages names the document's URI, so for a
 * `file://` document the report is nothing but `<REDACTED: URL>`, and for a
 * notebook cell it is `Document not available: vscode-notebook-cel<REDACTED:
 * user-file-path> e <REDACTED: user-file-path>#W2sZmlsZQ==.` — neither of
 * which any message pattern could safely match.
 *
 * A plain identifier contains nothing the cleaning touches, so the name
 * arrives exactly as it was set.
 */
export const DOCUMENT_STATE_ERROR_NAME = 'JuliaLanguageServerDocumentStateError'

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
 *
 * A `ResponseError` is classified by its code, and for the generic
 * `InvalidParams` code also by its message, which is still the server's own
 * at that point. Any other error is one that has lost its code on the way to
 * crash reporting: it is recognised by the name {@link tagDocumentStateError}
 * gave it before it did, or failing that by its message.
 */
export function isExpectedDocumentStateError(err: unknown): boolean {
    if (err instanceof ResponseError) {
        switch (err.code) {
            case JLS_NO_DOCUMENT:
            case JLS_VERSION_MISMATCH:
                return true
            case ErrorCodes.InvalidParams:
                return missingDocumentPattern.test(err.message)
            default:
                return false
        }
    }
    if (err instanceof Error) {
        return (
            err.name === DOCUMENT_STATE_ERROR_NAME ||
            documentStateMessagePatterns.some((pattern) => pattern.test(err.message))
        )
    }
    return false
}

/**
 * Names a request's failure {@link DOCUMENT_STATE_ERROR_NAME} if it is a
 * document-state answer of the server, so that it can still be recognised
 * after VS Code has rebuilt it for crash reporting. Returns the error, for
 * rethrowing.
 *
 * Only `ResponseError`s are named — the answer as it came off the wire, with
 * its code intact — and nothing else about them changes: the instance, its
 * prototype, code and message stay as they are, so a caller that handles the
 * answer by its code, or with {@link isExpectedDocumentStateError}, sees what
 * it always did.
 */
export function tagDocumentStateError<T>(err: T): T {
    if (err instanceof ResponseError && isExpectedDocumentStateError(err)) {
        err.name = DOCUMENT_STATE_ERROR_NAME
    }
    return err
}

/**
 * Message prefixes of language server response errors that must not become
 * extension crash reports. Like `teardownMessages` above, these arrive at
 * `sendErrorData` as rebuilt plain `Error`s without their `ResponseError`
 * code, so the message prefix is the only thing left to classify on.
 *
 * The prefix survives VS Code's cleaning as long as the rest of the message
 * does not contain a URL; a single-line message that does is replaced whole
 * by `<REDACTED: URL>` and cannot be recognised here any more (see
 * {@link DOCUMENT_STATE_ERROR_NAME}).
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
 * are gone, and what is left of the message is what VS Code's cleaning made
 * of it (see {@link DOCUMENT_STATE_ERROR_NAME}). Telemetry carries such
 * reports whose message is nothing but `<REDACTED: URL>`. That is not a
 * message that was only a URL: the cleaning replaces a single-line message
 * *whole* as soon as it contains one, so any server answer that names a
 * `file://` document ends up like this. The server's document-state answers
 * are the common case, and are now recognised by their name instead; for
 * anything else there is nothing left in the report to say which request it
 * belongs to, or even which of the connections it came from.
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
