import * as assert from 'assert'
import { OutputCoalescer } from '../../../testing/outputCoalescer'

/** A stand-in for `setTimeout`, so the tests do not have to wait for real windows to elapse. */
class FakeClock {
    private callbacks = new Map<number, () => void>()
    private nextHandle = 1

    schedule = (cb: () => void): unknown => {
        const handle = this.nextHandle++
        this.callbacks.set(handle, cb)
        return handle
    }

    cancel = (handle: unknown) => {
        this.callbacks.delete(handle as number)
    }

    get scheduledCount() {
        return this.callbacks.size
    }

    /** Run everything currently scheduled. */
    tick() {
        const due = [...this.callbacks.values()]
        this.callbacks.clear()
        for (const cb of due) {
            cb()
        }
    }
}

function build() {
    const clock = new FakeClock()
    const flushed: string[] = []
    const coalescer = new OutputCoalescer(30, (text) => flushed.push(text), clock.schedule, clock.cancel)
    return { clock, flushed, coalescer }
}

suite('OutputCoalescer', () => {
    test('batches everything pushed inside one window into a single flush', () => {
        const { clock, flushed, coalescer } = build()

        coalescer.push('a')
        coalescer.push('b')
        coalescer.push('c')

        assert.deepStrictEqual(flushed, [], 'nothing is emitted before the window elapses')
        assert.strictEqual(clock.scheduledCount, 1, 'only the first push schedules a flush')

        clock.tick()

        assert.deepStrictEqual(flushed, ['abc'])
    })

    test('preserves order across batches', () => {
        const { clock, flushed, coalescer } = build()

        coalescer.push('one ')
        coalescer.push('two ')
        clock.tick()
        coalescer.push('three')
        clock.tick()

        assert.deepStrictEqual(flushed, ['one two ', 'three'])
    })

    test('starts a new window after a flush', () => {
        const { clock, flushed, coalescer } = build()

        coalescer.push('a')
        clock.tick()
        assert.strictEqual(clock.scheduledCount, 0)

        coalescer.push('b')
        assert.strictEqual(clock.scheduledCount, 1, 'the next push schedules again')

        clock.tick()
        assert.deepStrictEqual(flushed, ['a', 'b'])
    })

    test('ignores empty pushes', () => {
        const { clock, flushed, coalescer } = build()

        coalescer.push('')

        assert.strictEqual(clock.scheduledCount, 0)
        clock.tick()
        assert.deepStrictEqual(flushed, [])
    })

    test('a tick with nothing buffered flushes nothing', () => {
        const { clock, flushed, coalescer } = build()

        coalescer.push('a')
        clock.tick()
        clock.tick()

        assert.deepStrictEqual(flushed, ['a'])
    })

    test('flushNow emits immediately and cancels the pending window', () => {
        const { clock, flushed, coalescer } = build()

        coalescer.push('a')
        coalescer.flushNow()

        assert.deepStrictEqual(flushed, ['a'])
        assert.strictEqual(clock.scheduledCount, 0)

        clock.tick()
        assert.deepStrictEqual(flushed, ['a'], 'the cancelled window must not flush again')
    })

    test('dispose drops what was buffered without emitting it', () => {
        const { clock, flushed, coalescer } = build()

        coalescer.push('a')
        coalescer.dispose()

        assert.strictEqual(clock.scheduledCount, 0)
        clock.tick()
        assert.deepStrictEqual(flushed, [])
    })
})
