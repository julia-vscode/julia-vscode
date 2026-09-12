import {
    ConnectionError,
    ConnectionErrors,
    ErrorCodes,
    LSPErrorCodes,
    ResponseError,
} from 'vscode-languageserver-protocol'

/**
 * Node error codes raised when the language server's stdin pipe or socket
 * goes away underneath a pending write.
 */
const teardownStreamCodes = new Set(['EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END'])

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
