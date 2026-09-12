import * as assert from 'assert'
import {
    ConnectionError,
    ConnectionErrors,
    ErrorCodes,
    LSPErrorCodes,
    ResponseError,
} from 'vscode-languageserver-protocol'
import { isLanguageServerError } from '../../languageServerErrors'

function nodeError(message: string, code: string): Error {
    return Object.assign(new Error(message), { code })
}

suite('isLanguageServerError', () => {
    test('recognises the jsonrpc and LSP response codes for a lost or cancelled request', () => {
        for (const code of [
            ErrorCodes.PendingResponseRejected,
            ErrorCodes.ConnectionInactive,
            ErrorCodes.MessageWriteError,
            LSPErrorCodes.RequestCancelled,
            LSPErrorCodes.ServerCancelled,
            LSPErrorCodes.ContentModified,
        ]) {
            assert.strictEqual(isLanguageServerError(new ResponseError(code, 'x')), true, `code ${code}`)
        }
    })

    test('does not match other response codes', () => {
        assert.strictEqual(isLanguageServerError(new ResponseError(ErrorCodes.InternalError, 'boom')), false)
        assert.strictEqual(isLanguageServerError(new ResponseError(-33101, 'no module')), false)
        // A response error is classified by its code alone; the message
        // fallback below is only for errors that lost their code.
        assert.strictEqual(
            isLanguageServerError(new ResponseError(ErrorCodes.InternalError, 'Connection is disposed.')),
            false
        )
    })

    test('recognises a disposed or closed jsonrpc connection', () => {
        assert.strictEqual(
            isLanguageServerError(new ConnectionError(ConnectionErrors.Disposed, 'Connection is disposed.')),
            true
        )
        assert.strictEqual(
            isLanguageServerError(new ConnectionError(ConnectionErrors.Closed, 'Connection is closed.')),
            true
        )
        assert.strictEqual(isLanguageServerError(new ConnectionError(ConnectionErrors.AlreadyListening, 'x')), false)
    })

    test('recognises Node stream and socket teardown errors by code', () => {
        assert.strictEqual(isLanguageServerError(nodeError('write EPIPE', 'EPIPE')), true)
        assert.strictEqual(
            isLanguageServerError(nodeError('Cannot call write after a stream was destroyed', 'ERR_STREAM_DESTROYED')),
            true
        )
        assert.strictEqual(isLanguageServerError(nodeError('read ECONNRESET', 'ECONNRESET')), true)
        assert.strictEqual(isLanguageServerError(nodeError('no such file', 'ENOENT')), false)
    })

    test('recognises errors rebuilt by VS Code, which keep only the message', () => {
        for (const message of [
            'Pending response rejected since connection got disposed',
            'Connection is disposed.',
            'Connection is closed.',
            'Client is not running',
            "Client is not running and can't be stopped. It's current state is: starting",
            "Client is not running and can't be stopped. It's current state is: startFailed",
            'Cannot call write after a stream was destroyed',
            'write EPIPE',
            'This socket has been ended by the other party',
        ]) {
            assert.strictEqual(isLanguageServerError(new Error(message)), true, message)
        }
    })

    test('matches messages exactly, never as a substring', () => {
        assert.strictEqual(
            isLanguageServerError(new Error('Pending response rejected since connection got disposed: more')),
            false
        )
        assert.strictEqual(isLanguageServerError(new Error('Error: Connection is disposed.')), false)
    })

    test('does not match unrelated values', () => {
        assert.strictEqual(isLanguageServerError(new Error('boom')), false)
        assert.strictEqual(isLanguageServerError(new TypeError('x is not a function')), false)
        assert.strictEqual(isLanguageServerError('Connection is disposed.'), false)
        assert.strictEqual(isLanguageServerError(undefined), false)
        assert.strictEqual(isLanguageServerError(null), false)
    })
})
