import * as assert from 'assert'
import { isExpectedInterruptSignalError } from '../../interactive/repl'

suite('isExpectedInterruptSignalError', () => {
    test('treats a vanished REPL process as expected', () => {
        const err: NodeJS.ErrnoException = new Error('kill ESRCH')
        err.code = 'ESRCH'
        assert.strictEqual(isExpectedInterruptSignalError(err), true)
    })

    test('reports any other signalling failure', () => {
        const err: NodeJS.ErrnoException = new Error('kill EPERM')
        err.code = 'EPERM'
        assert.strictEqual(isExpectedInterruptSignalError(err), false)
    })

    test('reports an error without a code, such as the null terminal TypeError', () => {
        assert.strictEqual(
            isExpectedInterruptSignalError(new TypeError("Cannot read properties of null (reading 'processId')")),
            false
        )
    })

    test('tolerates a null or undefined rejection value', () => {
        assert.strictEqual(isExpectedInterruptSignalError(null), false)
        assert.strictEqual(isExpectedInterruptSignalError(undefined), false)
    })
})
