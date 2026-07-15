import * as assert from 'assert'
import { CloseAction, ErrorAction, ErrorHandler } from 'vscode-languageclient/node'
import { RestartTrackingErrorHandler } from '../../languageClient'

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
