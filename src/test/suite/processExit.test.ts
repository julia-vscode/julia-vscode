import * as assert from 'assert'
import { formatBytes, osKillNotification, osKillReport } from '../../processExit'

const GIB = 1024 * 1024 * 1024

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
        assert.strictEqual(formatBytes(GIB), '1.0 GiB')
    })

    test('stops scaling at the largest unit it knows', () => {
        assert.strictEqual(formatBytes(1024 ** 5), '1024.0 TiB')
    })
})

suite('osKillReport', () => {
    test('names the process and the signal, and sizes the memory the machine had left', () => {
        const report = osKillReport(
            'Julia test item controller',
            'SIGKILL',
            { total: 16 * GIB, free: 256 * 1024 * 1024, cgroupLimit: null },
            ['Test processes alive: 7']
        )

        assert.match(report, /Julia test item controller/)

        assert.match(report, /SIGKILL/)
        assert.match(report, /256\.0 MiB free of 16\.0 GiB/)
        assert.match(report, /cgroup limit none/)
        assert.match(report, /Test processes alive: 7/)
    })

    test('sizes a cgroup limit when there is one, which is what a container stop looks like', () => {
        const report = osKillReport('Julia language server', 'SIGKILL', {
            total: 64 * GIB,
            free: 32 * GIB,
            cgroupLimit: 2 * GIB,
        })

        assert.match(report, /cgroup limit 2\.0 GiB/)
    })

    test('carries no paths or package names, only numbers and the signal', () => {
        const report = osKillReport('Julia language server', 'SIGTERM', {
            total: GIB,
            free: GIB,
            cgroupLimit: null,
        })

        assert.ok(!report.includes('/'))
        assert.ok(!report.includes('\\'))
    })
})

suite('osKillNotification', () => {
    test('names the process and the signal, and hedges on the cause', () => {
        const text = osKillNotification('The Julia language server', 'SIGKILL')

        assert.match(text, /The Julia language server/)
        assert.match(text, /SIGKILL/)
        assert.match(text, /most likely/)
    })
})

suite('osKillReport, language server shape', () => {
    test('carries the Julia it was running and the tail of its stderr', () => {
        const report = osKillReport(
            'Julia language server',
            'SIGKILL',
            { total: 8 * GIB, free: 128 * 1024 * 1024, cgroupLimit: null },
            ['Julia: julia (1.13.0)', '', 'Last stderr output:', '[ Info: Indexing child process done']
        )

        assert.match(report, /Julia language server was killed with SIGKILL/)
        assert.match(report, /128\.0 MiB free of 8\.0 GiB/)
        assert.match(report, /Julia: julia \(1\.13\.0\)/)
        assert.match(report, /Indexing child process done/)
    })

    test('omits the extra block entirely when there is nothing to add', () => {
        const report = osKillReport('Julia language server', 'SIGKILL', {
            total: GIB,
            free: GIB,
            cgroupLimit: null,
        })

        assert.strictEqual(report.split('\n').length, 2)
    })
})
