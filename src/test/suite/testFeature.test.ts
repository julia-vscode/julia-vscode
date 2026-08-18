import * as assert from 'assert'
import { formatBytes, formatMillis, formatPerfStats, testItemKey } from '../../testing/testFeature'

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

suite('formatBytes', () => {
    test('leaves byte counts unscaled and undecorated', () => {
        assert.strictEqual(formatBytes(0), '0 B')
        assert.strictEqual(formatBytes(512), '512 B')
        assert.strictEqual(formatBytes(1023), '1023 B')
    })

    test('scales at each 1024 boundary', () => {
        assert.strictEqual(formatBytes(1024), '1.0 KiB')
        assert.strictEqual(formatBytes(1536), '1.5 KiB')
        assert.strictEqual(formatBytes(1024 * 1024), '1.0 MiB')
        assert.strictEqual(formatBytes(1024 * 1024 * 1024), '1.0 GiB')
    })

    test('stops scaling at the largest unit it knows', () => {
        assert.strictEqual(formatBytes(1024 ** 5), '1024.0 TiB')
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
