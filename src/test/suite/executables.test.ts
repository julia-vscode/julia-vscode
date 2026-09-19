import * as assert from 'assert'
import { JuliaNotFoundError, JuliaProbeFailedError, JuliaProbeTimeoutError } from '../../executables'

suite('JuliaNotFoundError subclasses', () => {
    // Every caller of `ExecutableFeature` filters on `instanceof JuliaNotFoundError` to
    // tell an expected "no usable Julia" outcome from an extension fault, and that is the
    // only thing keeping these out of crash reporting. A subclass that stopped satisfying
    // it would silently start filing reports again, so it is asserted here rather than
    // left to the type declaration.
    test('are all recognised as a missing or unusable Julia', () => {
        assert.ok(new JuliaProbeTimeoutError('julia', 5000) instanceof JuliaNotFoundError)
        assert.ok(new JuliaProbeFailedError('julia', new Error('exit 1')) instanceof JuliaNotFoundError)
    })

    test('keep a distinct name, so a report of one says which it was', () => {
        assert.strictEqual(new JuliaNotFoundError('Julia not installed').name, 'JuliaNotFoundError')
        assert.strictEqual(new JuliaProbeTimeoutError('julia', 5000).name, 'JuliaProbeTimeoutError')
        assert.strictEqual(new JuliaProbeFailedError('julia', new Error('exit 1')).name, 'JuliaProbeFailedError')
    })

    test('a failed probe names the executable and keeps the underlying error', () => {
        const cause = new Error('Command failed: julia --startup-file=no -e using Pkg')
        const err = new JuliaProbeFailedError('/opt/broken/julia', cause)

        assert.ok(err.message.includes('/opt/broken/julia'))
        assert.strictEqual(err.cause, cause)
    })
})
