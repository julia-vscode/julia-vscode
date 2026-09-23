import * as assert from 'assert'
import { CloseAction, ErrorAction, ErrorHandler, LanguageClient } from 'vscode-languageclient/node'
import { ErrorCodes, RequestType, ResponseError } from 'vscode-languageserver-protocol'
import {
    isExternalKillSignal,
    isReportableOsKill,
    ObservedLanguageClient,
    parseCgroupMemoryLimit,
    RestartTrackingErrorHandler,
    sanitizeHomeDir,
    StderrTail,
    unexpectedServerExit,
} from '../../languageClient'
import { DOCUMENT_STATE_ERROR_NAME } from '../../languageServerErrors'

function makeDelegate(closeActions: CloseAction[]): ErrorHandler {
    let i = 0
    return {
        error: () => ({ action: ErrorAction.Continue }),
        closed: () => ({ action: closeActions[Math.min(i++, closeActions.length - 1)] }),
    }
}

suite('RestartTrackingErrorHandler', () => {
    test('no restart pending before any connection close', () => {
        const handler = new RestartTrackingErrorHandler(() => makeDelegate([CloseAction.Restart]))
        assert.strictEqual(handler.consumeRestartPending(), false)
    })

    test('restart pending after delegate decides to auto-restart', async () => {
        const handler = new RestartTrackingErrorHandler(() => makeDelegate([CloseAction.Restart]))
        const result = await handler.closed()
        assert.strictEqual(result.action, CloseAction.Restart)
        assert.strictEqual(handler.consumeRestartPending(), true)
    })

    test('consuming the pending restart resets it', async () => {
        const handler = new RestartTrackingErrorHandler(() => makeDelegate([CloseAction.Restart]))
        await handler.closed()
        assert.strictEqual(handler.consumeRestartPending(), true)
        assert.strictEqual(handler.consumeRestartPending(), false)
    })

    test('no restart pending when delegate gives up', async () => {
        const handler = new RestartTrackingErrorHandler(() => makeDelegate([CloseAction.DoNotRestart]))
        const result = await handler.closed()
        assert.strictEqual(result.action, CloseAction.DoNotRestart)
        assert.strictEqual(handler.consumeRestartPending(), false)
    })

    test('crash loop: restarts stay pending until the delegate gives up', async () => {
        const handler = new RestartTrackingErrorHandler(() =>
            makeDelegate([
                CloseAction.Restart,
                CloseAction.Restart,
                CloseAction.Restart,
                CloseAction.Restart,
                CloseAction.DoNotRestart,
            ])
        )
        for (let crash = 0; crash < 4; crash++) {
            await handler.closed()
            assert.strictEqual(handler.consumeRestartPending(), true)
        }
        await handler.closed()
        assert.strictEqual(handler.consumeRestartPending(), false)
    })

    test('delegates error decisions unchanged', async () => {
        const handler = new RestartTrackingErrorHandler(() => makeDelegate([CloseAction.Restart]))
        const result = await handler.error(new Error('boom'), undefined, 1)
        assert.strictEqual(result.action, ErrorAction.Continue)
        assert.strictEqual(handler.consumeRestartPending(), false)
    })
})

suite('unexpectedServerExit', () => {
    test('a clean exit is expected', () => {
        assert.strictEqual(unexpectedServerExit(0, null, false), null)
    })

    test('exit code 1 is the Julia error handler, which reports on its own', () => {
        assert.strictEqual(unexpectedServerExit(1, null, false), null)
    })

    test('nothing is reported for an intentional stop, however it ended', () => {
        assert.strictEqual(unexpectedServerExit(null, 'SIGKILL', true), null)
        assert.strictEqual(unexpectedServerExit(139, null, true), null)
    })

    test('a native crash signal is reported', () => {
        assert.match(unexpectedServerExit(null, 'SIGSEGV', false), /signal SIGSEGV/)
        assert.match(unexpectedServerExit(null, 'SIGABRT', false), /signal SIGABRT/)
    })

    test('a kill signal is not a crash of ours, so it is not reported', () => {
        assert.strictEqual(unexpectedServerExit(null, 'SIGKILL', false), null)
        assert.strictEqual(unexpectedServerExit(null, 'SIGTERM', false), null)
    })

    test('a runtime exit code is reported', () => {
        assert.match(unexpectedServerExit(139, null, false), /code 139/)
        assert.match(unexpectedServerExit(3221225477, null, false), /code 3221225477/)
    })

    test('an exit forced by the OS during session teardown is expected', () => {
        // DBG_TERMINATE_PROCESS: the OS killed the running server at logoff.
        assert.strictEqual(unexpectedServerExit(1073807364, null, false), null)
        // STATUS_DLL_INIT_FAILED: the restarted server could not initialise
        // in a session that is shutting down.
        assert.strictEqual(unexpectedServerExit(3221225794, null, false), null)
    })

    test('an unexplained external termination is still reported', () => {
        assert.match(unexpectedServerExit(4294967295, null, false), /code 4294967295/)
    })
})

suite('isExternalKillSignal', () => {
    test('kill signals come from outside the process tree', () => {
        assert.strictEqual(isExternalKillSignal('SIGKILL'), true)
        assert.strictEqual(isExternalKillSignal('SIGTERM'), true)
    })

    test('a native crash is not an OS kill', () => {
        assert.strictEqual(isExternalKillSignal('SIGSEGV'), false)
        assert.strictEqual(isExternalKillSignal('SIGABRT'), false)
        assert.strictEqual(isExternalKillSignal('SIGBUS'), false)
        assert.strictEqual(isExternalKillSignal('SIGILL'), false)
    })

    test('an exit without a signal is not an OS kill', () => {
        assert.strictEqual(isExternalKillSignal(null), false)
    })
})

suite('isReportableOsKill', () => {
    test('an out-of-memory kill is worth reporting', () => {
        assert.strictEqual(isReportableOsKill('SIGKILL'), true)
    })

    test('a SIGTERM is somebody elses teardown, not a report', () => {
        assert.strictEqual(isReportableOsKill('SIGTERM'), false)
    })

    test('nothing else is an OS kill at all', () => {
        assert.strictEqual(isReportableOsKill('SIGSEGV'), false)
        assert.strictEqual(isReportableOsKill(null), false)
    })
})

suite('parseCgroupMemoryLimit', () => {
    test('reads a byte count', () => {
        assert.strictEqual(parseCgroupMemoryLimit('2147483648'), 2147483648)
        assert.strictEqual(parseCgroupMemoryLimit('2147483648\n'), 2147483648)
    })

    test('cgroup v2 writes max when there is no limit', () => {
        assert.strictEqual(parseCgroupMemoryLimit('max'), null)
        assert.strictEqual(parseCgroupMemoryLimit('max\n'), null)
    })

    test('cgroup v1 expresses no limit as an implausibly large number', () => {
        assert.strictEqual(parseCgroupMemoryLimit('9223372036854771712'), null)
    })

    test('an unreadable or empty value is no limit', () => {
        assert.strictEqual(parseCgroupMemoryLimit(''), null)
        assert.strictEqual(parseCgroupMemoryLimit('   '), null)
        assert.strictEqual(parseCgroupMemoryLimit('not a number'), null)
        assert.strictEqual(parseCgroupMemoryLimit('-1'), null)
        assert.strictEqual(parseCgroupMemoryLimit('0'), null)
    })
})

suite('StderrTail', () => {
    test('is empty by default', () => {
        assert.strictEqual(new StderrTail().text(), '')
    })

    test('keeps only the last characters across appends', () => {
        const tail = new StderrTail(8)
        tail.append('abc')
        tail.append(Buffer.from('defgh'))
        assert.strictEqual(tail.text(), 'abcdefgh')
        tail.append('ij')
        assert.strictEqual(tail.text(), 'cdefghij')
    })
})

suite('sanitizeHomeDir', () => {
    test('replaces the home directory in either slash style', () => {
        assert.strictEqual(
            sanitizeHomeDir('at C:\\Users\\me\\x.jl and C:/Users/me/y.jl', 'C:\\Users\\me'),
            'at ~\\x.jl and ~/y.jl'
        )
        assert.strictEqual(sanitizeHomeDir('at /home/me/x.jl', '/home/me'), 'at ~/x.jl')
    })

    test('leaves text alone without a home directory', () => {
        assert.strictEqual(sanitizeHomeDir('at /home/me/x.jl', ''), 'at /home/me/x.jl')
    })
})

suite('ObservedLanguageClient.sendRequest', () => {
    // No server is started: the base class's `sendRequest` is replaced for the
    // duration of each test by one that records its arguments and answers with
    // the given outcome, the way a request to a real server would.
    let calls: unknown[][]
    let outcome: () => Promise<unknown>
    let client: ObservedLanguageClient

    setup(() => {
        calls = []
        Object.defineProperty(LanguageClient.prototype, 'sendRequest', {
            configurable: true,
            writable: true,
            value: function (...args: unknown[]) {
                calls.push(args)
                return outcome()
            },
        })
        client = new ObservedLanguageClient(
            'julia-test',
            'Julia Test',
            { command: 'julia-that-is-never-started' },
            {},
            () => {}
        )
    })

    teardown(() => {
        delete (LanguageClient.prototype as unknown as Record<string, unknown>).sendRequest
    })

    test('forwards the request and its answer unchanged', async () => {
        outcome = () => Promise.resolve('Main')
        const requestType = new RequestType<{ word: string }, string, void>('julia/getDocFromWord')
        const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) }
        assert.strictEqual(await client.sendRequest(requestType, { word: 'x' }, token), 'Main')
        assert.strictEqual(await client.sendRequest<string>('julia/getModuleAt', { a: 1 }), 'Main')
        assert.strictEqual(await client.sendRequest<string>('julia/noParams'), 'Main')
        assert.deepStrictEqual(calls, [
            [requestType, { word: 'x' }, token],
            ['julia/getModuleAt', { a: 1 }],
            ['julia/noParams'],
        ])
    })

    test('names a document-state answer, keeping the same error with its code and message', async () => {
        const answer = new ResponseError(ErrorCodes.InvalidParams, 'Document not available: file:///c%3A/x/a.jl.')
        outcome = () => Promise.reject(answer)
        await assert.rejects(client.sendRequest('julia/getModuleAt', {}), (err: unknown) => {
            assert.strictEqual(err, answer)
            assert.ok(err instanceof ResponseError)
            assert.strictEqual(err.name, DOCUMENT_STATE_ERROR_NAME)
            assert.strictEqual(err.code, ErrorCodes.InvalidParams)
            assert.strictEqual(err.message, 'Document not available: file:///c%3A/x/a.jl.')
            return true
        })
    })

    test('rethrows any other failure untouched', async () => {
        for (const failure of [
            new ResponseError(ErrorCodes.InvalidParams, 'Invalid params'),
            new ResponseError(ErrorCodes.InternalError, 'boom'),
            new TypeError('boom'),
        ]) {
            const name = failure.name
            outcome = () => Promise.reject(failure)
            await assert.rejects(client.sendRequest('textDocument/hover', {}), (err: unknown) => {
                assert.strictEqual(err, failure)
                assert.strictEqual((err as Error).name, name)
                return true
            })
        }
    })
})
