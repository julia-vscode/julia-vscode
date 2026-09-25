import * as assert from 'assert'
import {
    formatMillis,
    formatPerfStats,
    JuliaTestProcess,
    pairWithPublishedDetails,
    testItemKey,
    unexpectedControllerExit,
} from '../../testing/testFeature'

suite('formatMillis', () => {
    test('renders sub-millisecond values as microseconds', () => {
        assert.strictEqual(formatMillis(0.5), '500 µs')
        assert.strictEqual(formatMillis(0.0123), '12 µs')
    })

    test('rounds a vanishing value to zero microseconds rather than showing a fraction', () => {
        assert.strictEqual(formatMillis(0.0004), '0 µs')
    })

    test('keeps one decimal below ten milliseconds', () => {
        assert.strictEqual(formatMillis(1), '1.0 ms')
        assert.strictEqual(formatMillis(3.14), '3.1 ms')
    })

    test('drops the decimal from ten milliseconds up', () => {
        assert.strictEqual(formatMillis(10), '10 ms')
        assert.strictEqual(formatMillis(123.4), '123 ms')
    })

    test('switches to seconds at one thousand milliseconds', () => {
        assert.strictEqual(formatMillis(999), '999 ms')
        assert.strictEqual(formatMillis(1000), '1.00 s')
        assert.strictEqual(formatMillis(1234), '1.23 s')
    })
})

suite('formatPerfStats', () => {
    test('returns undefined when the test process measured nothing', () => {
        assert.strictEqual(formatPerfStats({}), undefined)
    })

    test('renders every field in order when all are present', () => {
        const result = formatPerfStats({
            elapsed: 1234,
            bytes: 1024 * 1024,
            allocs: 12345,
            gctime: 80,
            compileTime: 310,
            recompileTime: 12,
        })

        assert.strictEqual(result, '⏱ 1.23 s · 1.0 MiB · 12,345 allocs · gc 80 ms · compile 310 ms · recompile 12 ms')
    })

    test('omits only the fields that are absent', () => {
        assert.strictEqual(formatPerfStats({ elapsed: 1234 }), '⏱ 1.23 s')
        assert.strictEqual(formatPerfStats({ elapsed: 1234, allocs: 7 }), '⏱ 1.23 s · 7 allocs')
        assert.strictEqual(formatPerfStats({ compileTime: 310 }), '⏱ compile 310 ms')
    })

    test('renders a measured zero rather than treating it as absent', () => {
        assert.strictEqual(formatPerfStats({ allocs: 0 }), '⏱ 0 allocs')
        assert.strictEqual(formatPerfStats({ bytes: 0 }), '⏱ 0 B')
    })

    test('groups large allocation counts', () => {
        assert.strictEqual(formatPerfStats({ allocs: 1234567 }), '⏱ 1,234,567 allocs')
    })
})

suite('testItemKey', () => {
    test('separates two items that share an id but ran under different environments', () => {
        // The case the key exists for: one package checked out twice mints the same test item
        // id from both copies, and only the environment tells them apart.
        const id = 'MyPkg@1a2b3c4d/test/runtests.jl::adds'

        assert.notStrictEqual(testItemKey('env-1', id), testItemKey('env-2', id))
    })

    test('separates two items in the same environment', () => {
        assert.notStrictEqual(testItemKey('env-1', 'a'), testItemKey('env-1', 'b'))
    })

    test('is stable for the same pair', () => {
        assert.strictEqual(testItemKey('env-1', 'a'), testItemKey('env-1', 'a'))
    })
})

suite('JuliaTestProcess', () => {
    const build = () =>
        new JuliaTestProcess('id', 'MyPkg', 'file:///pkg', 'file:///pkg/Project.toml', false, {}, 'release', undefined)

    test('starts out alive, with an empty log', () => {
        const proc = build()

        assert.strictEqual(proc.isTerminated(), false)
        assert.strictEqual(proc.log.getFullText(), '')
    })

    test('marks a footer onto the log when it terminates', () => {
        const proc = build()
        proc.log.append('some output\n')

        proc.markTerminated()

        assert.strictEqual(proc.isTerminated(), true)
        assert.ok(proc.log.getFullText().includes('test process terminated'))
    })

    test('terminating twice does not append a second footer', () => {
        const proc = build()

        proc.markTerminated()
        const afterFirst = proc.log.getFullText()
        proc.markTerminated()

        assert.strictEqual(proc.log.getFullText(), afterFirst)
    })

    test('killing a terminated process does not reach for the controller', async () => {
        // The controller is `undefined` here, so this would throw if the guard were missing —
        // which is the real case too: the tree node outlives the process it points at.
        const proc = build()
        proc.markTerminated()

        await proc.kill()
    })
})

suite('pairWithPublishedDetails', () => {
    // The real map is a `WeakMap<vscode.TestItem, TestItemDetail>`; the only thing that
    // matters here is that a lookup can miss, so plain objects stand in for both.
    const withDetails = (entries: Map<string, string>) => (item: string) => entries.get(item)

    test('pairs every item with its details when nothing changed', () => {
        const details = new Map([
            ['a', 'details-a'],
            ['b', 'details-b'],
        ])

        const { paired, dropped } = pairWithPublishedDetails(['a', 'b'], withDetails(details))

        assert.deepStrictEqual(paired, [
            { testItem: 'a', details: 'details-a' },
            { testItem: 'b', details: 'details-b' },
        ])
        assert.deepStrictEqual(dropped, [])
    })

    test('drops an item whose details went away and keeps the rest of the run', () => {
        // What a republish of `b`'s file does: its previous `vscode.TestItem` is no longer
        // a key of the details map, while the array being assembled still holds it.
        const details = new Map([
            ['a', 'details-a'],
            ['c', 'details-c'],
        ])

        const { paired, dropped } = pairWithPublishedDetails(['a', 'b', 'c'], withDetails(details))

        assert.deepStrictEqual(paired, [
            { testItem: 'a', details: 'details-a' },
            { testItem: 'c', details: 'details-c' },
        ])
        assert.deepStrictEqual(dropped, ['b'])
    })

    test('reports every item as dropped when the whole file was republished', () => {
        const { paired, dropped } = pairWithPublishedDetails(['a', 'b'], withDetails(new Map()))

        assert.deepStrictEqual(paired, [])
        assert.deepStrictEqual(dropped, ['a', 'b'])
    })

    test('keeps details that are falsy but present', () => {
        // `undefined` is the only value that means "not there": a `TestItemDetail` is an
        // object today, but the check must not turn on truthiness.
        const { paired, dropped } = pairWithPublishedDetails([0], (item: number) => (item === 0 ? '' : undefined))

        assert.deepStrictEqual(paired, [{ testItem: 0, details: '' }])
        assert.deepStrictEqual(dropped, [])
    })

    test('handles an empty run', () => {
        const { paired, dropped } = pairWithPublishedDetails([], withDetails(new Map()))

        assert.deepStrictEqual(paired, [])
        assert.deepStrictEqual(dropped, [])
    })
})

suite('unexpectedControllerExit', () => {
    test('says nothing about a clean exit', () => {
        assert.strictEqual(unexpectedControllerExit(0, null, false), null)
    })

    test('says nothing about code 1, which the controller already reported itself', () => {
        assert.strictEqual(unexpectedControllerExit(1, null, false), null)
    })

    test('says nothing about the SIGTERM our own stop path sends', () => {
        assert.strictEqual(unexpectedControllerExit(null, 'SIGTERM', true), null)
    })

    test('says nothing about the Windows session-teardown exit codes', () => {
        assert.strictEqual(unexpectedControllerExit(1073807364, null, false), null)
        assert.strictEqual(unexpectedControllerExit(3221225794, null, false), null)
    })

    test('reports a native crash signal, even while stopping', () => {
        assert.match(unexpectedControllerExit(null, 'SIGSEGV', false), /signal SIGSEGV/)
        assert.match(unexpectedControllerExit(null, 'SIGABRT', false), /signal SIGABRT/)
    })

    test('reports a runtime exit code the controller cannot have reported itself', () => {
        assert.match(unexpectedControllerExit(4294967295, null, false), /code 4294967295/)
    })

    test('an intentional stop covers whatever the exit turns out to be', () => {
        assert.strictEqual(unexpectedControllerExit(null, 'SIGKILL', true), null)
        assert.strictEqual(unexpectedControllerExit(4294967295, null, true), null)
    })

    // A kill nobody here asked for is not a crash report, but it is not silence
    // either: the exit handler counts it as a `ticoskill` event. These two cases
    // are what that branch keys off, so they are pinned here as well.
    test('files no crash report for an unasked-for kill, which is counted instead', () => {
        assert.strictEqual(unexpectedControllerExit(null, 'SIGKILL', false), null)
        assert.strictEqual(unexpectedControllerExit(null, 'SIGTERM', false), null)
    })
})
