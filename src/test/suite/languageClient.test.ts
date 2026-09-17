import * as assert from 'assert'
import { CloseAction, ErrorAction, ErrorHandler } from 'vscode-languageclient/node'
import {
    isOsKillSignal,
    parseCgroupMemoryLimit,
    RestartTrackingErrorHandler,
    sanitizeHomeDir,
    StderrTail,
    unexpectedServerExit,
} from '../../languageClient'

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

suite('isOsKillSignal', () => {
    test('kill signals come from outside the process tree', () => {
        assert.strictEqual(isOsKillSignal('SIGKILL'), true)
        assert.strictEqual(isOsKillSignal('SIGTERM'), true)
    })

    test('a native crash is not an OS kill', () => {
        assert.strictEqual(isOsKillSignal('SIGSEGV'), false)
        assert.strictEqual(isOsKillSignal('SIGABRT'), false)
        assert.strictEqual(isOsKillSignal('SIGBUS'), false)
        assert.strictEqual(isOsKillSignal('SIGILL'), false)
    })

    test('an exit without a signal is not an OS kill', () => {
        assert.strictEqual(isOsKillSignal(null), false)
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
