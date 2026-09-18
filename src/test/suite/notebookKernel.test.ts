import * as assert from 'assert'
import { KernelStartError } from '../../notebook/notebookKernel'

suite('KernelStartError', () => {
    test('names the executable and carries the reason through', () => {
        const cause: NodeJS.ErrnoException = new Error('spawn UNKNOWN')
        cause.code = 'UNKNOWN'
        const err = new KernelStartError('julia.exe', cause)

        assert.match(err.message, /julia\.exe/)
        assert.match(err.message, /spawn UNKNOWN/)
    })

    test('tolerates a non-Error reason', () => {
        assert.match(new KernelStartError('julia', 'boom').message, /boom/)
    })

    test('is distinguishable from an ordinary failure, so it can skip crash reporting', () => {
        assert.ok(new KernelStartError('julia', new Error('nope')) instanceof KernelStartError)
        assert.ok(!(new Error('nope') instanceof KernelStartError))
    })
})
