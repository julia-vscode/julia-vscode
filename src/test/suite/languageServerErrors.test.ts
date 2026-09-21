import * as assert from 'assert'
import {
    ConnectionError,
    ConnectionErrors,
    ErrorCodes,
    LSPErrorCodes,
    ResponseError,
} from 'vscode-languageserver-protocol'
import {
    describeFailedRequest,
    formatFailedRequest,
    isExpectedDocumentStateError,
    isLanguageServerError,
    isLanguageServerResponseNoise,
} from '../../languageServerErrors'

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
        assert.strictEqual(isLanguageServerError(nodeError('write EOF', 'EOF')), true)
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
            'write EOF',
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

const NO_DOCUMENT_MESSAGE =
    'document git:/Users/x/.julia/dev/Sunny/examples/SW12.jl?%7B%22path%22:%22%22%7D requested but not present in the JLS for request getCurrentBlockRange'
const VERSION_MISMATCH_MESSAGE =
    'version mismatch in getCurrentBlockRange request for file:///c%3A/Users/x/Julia/Julia.jl: JLS 0, client: 1'
const MISSING_DOCUMENT_MESSAGE = 'Document not available: untitled:Untitled-1.'

suite('isExpectedDocumentStateError', () => {
    test('recognises the server codes for a document it cannot serve', () => {
        assert.strictEqual(isExpectedDocumentStateError(new ResponseError(-33100, NO_DOCUMENT_MESSAGE)), true)
        assert.strictEqual(isExpectedDocumentStateError(new ResponseError(-33101, VERSION_MISMATCH_MESSAGE)), true)
    })

    test('recognises the same answers rebuilt by VS Code, which keep only the message', () => {
        assert.strictEqual(isExpectedDocumentStateError(new Error(NO_DOCUMENT_MESSAGE)), true)
        assert.strictEqual(isExpectedDocumentStateError(new Error(VERSION_MISMATCH_MESSAGE)), true)
        assert.strictEqual(isExpectedDocumentStateError(new Error(MISSING_DOCUMENT_MESSAGE)), true)
    })

    test('recognises the request names the extension actually sends', () => {
        for (const request of ['getCurrentBlockRange', 'getModuleAt']) {
            assert.strictEqual(
                isExpectedDocumentStateError(
                    new Error(
                        `document untitled:Untitled-3 requested but not present in the JLS for request ${request}`
                    )
                ),
                true,
                request
            )
        }
    })

    test('does not match a message that merely embeds one of them', () => {
        assert.strictEqual(isExpectedDocumentStateError(new Error(`the server said: ${NO_DOCUMENT_MESSAGE}`)), false)
        // Trailing text that itself ends in a period is why the URI is matched
        // as a run of non-whitespace rather than as `.+`.
        assert.strictEqual(isExpectedDocumentStateError(new Error(`${MISSING_DOCUMENT_MESSAGE} Retrying.`)), false)
        // `document ` on its own must not be enough: a real crash whose
        // message happens to start that way still has to be reported.
        assert.strictEqual(isExpectedDocumentStateError(new Error('document is not defined')), false)
        assert.strictEqual(
            isExpectedDocumentStateError(new Error('version mismatch in the manifest for Foo.jl')),
            false
        )
    })

    test('does not match other response codes or unrelated values', () => {
        assert.strictEqual(isExpectedDocumentStateError(new ResponseError(ErrorCodes.InternalError, 'boom')), false)
        assert.strictEqual(isExpectedDocumentStateError(new Error('boom')), false)
        assert.strictEqual(isExpectedDocumentStateError(NO_DOCUMENT_MESSAGE), false)
        assert.strictEqual(isExpectedDocumentStateError(undefined), false)
        assert.strictEqual(isExpectedDocumentStateError(null), false)
    })
})

suite('isLanguageServerResponseNoise', () => {
    test('recognises a request-handler failure the server reports itself', () => {
        assert.strictEqual(
            isLanguageServerResponseNoise(new Error('Error handling request: MethodError(convert, ...)')),
            true
        )
    })

    test('recognises a formatting failure caused by unparseable user code', () => {
        assert.strictEqual(
            isLanguageServerResponseNoise(
                new Error('Could not format foo.jl because it could not be parsed as Julia code.')
            ),
            true
        )
    })

    test('also covers the document-state answers, as the net for unhandled paths', () => {
        assert.strictEqual(isLanguageServerResponseNoise(new Error(NO_DOCUMENT_MESSAGE)), true)
        assert.strictEqual(isLanguageServerResponseNoise(new Error(VERSION_MISMATCH_MESSAGE)), true)
        assert.strictEqual(isLanguageServerResponseNoise(new Error(MISSING_DOCUMENT_MESSAGE)), true)
    })

    test('matches only at the start of the message', () => {
        assert.strictEqual(isLanguageServerResponseNoise(new Error('failed: Error handling request: x')), false)
        assert.strictEqual(isLanguageServerResponseNoise(new Error('The server said Could not format foo.jl')), false)
    })

    test('does not match unrelated values', () => {
        assert.strictEqual(isLanguageServerResponseNoise(new Error('boom')), false)
        assert.strictEqual(isLanguageServerResponseNoise('Error handling request: x'), false)
        assert.strictEqual(isLanguageServerResponseNoise(undefined), false)
        assert.strictEqual(isLanguageServerResponseNoise(null), false)
    })
})

suite('describeFailedRequest', () => {
    test('keeps the method and the response code, which the report would lose', () => {
        const err = new ResponseError(-32803, 'https://example.com/a/b')
        assert.deepStrictEqual(describeFailedRequest('textDocument/formatting', err), {
            method: 'textDocument/formatting',
            code: '-32803',
            type: 'ResponseError',
        })
    })

    test('an error that is not a response error still names its type', () => {
        assert.deepStrictEqual(describeFailedRequest('textDocument/hover', new TypeError('boom')), {
            method: 'textDocument/hover',
            code: 'none',
            type: 'TypeError',
        })
    })

    test('a rejection that is not an error at all is still described', () => {
        assert.deepStrictEqual(describeFailedRequest('julia/getModuleAt', 'nope'), {
            method: 'julia/getModuleAt',
            code: 'none',
            type: 'string',
        })
    })

    test('carries no message text, since a message can hold anything', () => {
        const description = describeFailedRequest('textDocument/hover', new Error('/home/someone/secret.jl'))
        assert.strictEqual(
            Object.values(description).some((value) => value.includes('secret')),
            false
        )
    })

    test('reads as one line in the output channel', () => {
        assert.strictEqual(
            formatFailedRequest({ method: 'textDocument/hover', code: '-32803', type: 'ResponseError' }),
            "Request 'textDocument/hover' failed: ResponseError, code -32803"
        )
    })
})
