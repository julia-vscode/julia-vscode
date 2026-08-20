import * as assert from 'assert'
import { stripAnsi } from '../../../testing/ansi'
import { logFileContents, MAX_LOG_CHARS, TestProcessLog, TRUNCATION_NOTICE } from '../../../testing/testProcessLog'

const ESC = '\x1b'

suite('TestProcessLog', () => {
    test('replays everything that was appended', () => {
        const log = new TestProcessLog()

        log.append('one\n')
        log.append('two\n')

        assert.strictEqual(log.getFullText(), 'one\ntwo\n')
        assert.strictEqual(log.isTruncated(), false)

        log.dispose()
    })

    test('fires onDidAppend with the text it emitted', () => {
        const log = new TestProcessLog()
        const seen: string[] = []
        log.onDidAppend((text) => seen.push(text))

        log.append('a')
        log.append('b')

        assert.deepStrictEqual(seen, ['a', 'b'])

        log.dispose()
    })

    test('does not emit an unfinished escape sequence, and completes it on the next append', () => {
        const log = new TestProcessLog()
        const seen: string[] = []
        log.onDidAppend((text) => seen.push(text))

        log.append(`red${ESC}[3`)
        assert.deepStrictEqual(seen, ['red'])
        assert.strictEqual(log.getFullText(), 'red')

        log.append('1mrest')
        assert.deepStrictEqual(seen, ['red', `${ESC}[31mrest`])
        assert.strictEqual(log.getFullText(), `red${ESC}[31mrest`)

        log.dispose()
    })

    test('finish releases the held sequence before appending its own text', () => {
        const log = new TestProcessLog()

        log.append(`out${ESC}[3`)
        log.finish('\r\ndone\r\n')

        assert.strictEqual(log.getFullText(), `out${ESC}[3\r\ndone\r\n`)

        log.dispose()
    })

    test('drops the oldest output once past the size cap', () => {
        const log = new TestProcessLog()
        const chunk = 'x'.repeat(100_000)

        // One chunk beyond the cap, so at least the first has to go.
        const chunks = Math.ceil(MAX_LOG_CHARS / chunk.length) + 1
        for (let i = 0; i < chunks; i++) {
            log.append(chunk)
        }

        assert.strictEqual(log.isTruncated(), true)

        const text = log.getFullText()
        assert.ok(text.startsWith(TRUNCATION_NOTICE), 'a truncated log says so')
        assert.ok(
            text.length - TRUNCATION_NOTICE.length <= MAX_LOG_CHARS,
            `retained ${text.length} characters, over the ${MAX_LOG_CHARS} cap`
        )
        // The tail is what matters — a crash is at the end of the log, not the start.
        assert.ok(text.endsWith(chunk))

        log.dispose()
    })

    test('leaves the retained text well formed after eviction', () => {
        const log = new TestProcessLog()

        // A well formed stream, fed in fixed size pieces whose length shares no factor with the
        // line length — so cuts land inside escape sequences over and over, the way pipe reads
        // do. Without the splitter, eviction could then start the retained text between an
        // `ESC [` and its final byte.
        const line = `${ESC}[36m` + 'y'.repeat(120) + `${ESC}[0m\n`
        const stream = line.repeat(Math.ceil((MAX_LOG_CHARS * 1.5) / line.length))

        const pieceSize = 7919
        for (let at = 0; at < stream.length; at += pieceSize) {
            log.append(stream.slice(at, at + pieceSize))
        }

        assert.strictEqual(log.isTruncated(), true)

        const text = log.getFullText()
        // Stripping the retained text must not leave escape fragments behind, which is what a
        // cut through the middle of a sequence would produce.
        assert.ok(!stripAnsi(text).includes(ESC), 'retained text contains a partial escape sequence')
        assert.ok(text.endsWith(`${ESC}[0m\n`), 'the tail of the stream is what survives')

        log.dispose()
    })

    test('always keeps at least the most recent chunk, however large', () => {
        const log = new TestProcessLog()
        const huge = 'z'.repeat(MAX_LOG_CHARS * 2)

        log.append(huge)

        assert.ok(log.getFullText().endsWith('z'))

        log.dispose()
    })

    test('stops emitting once disposed', () => {
        const log = new TestProcessLog()
        let count = 0
        log.onDidAppend(() => count++)

        log.append('a')
        log.dispose()

        assert.strictEqual(count, 1)
        assert.strictEqual(log.getFullText(), '')
    })
})

suite('logFileContents', () => {
    test('strips the escapes a saved log would otherwise show as text', () => {
        const log = new TestProcessLog()
        log.append(`${ESC}[32m[ Info: ${ESC}[39mprecompiling\n`)

        assert.strictEqual(logFileContents(log), '[ Info: precompiling\n')

        log.dispose()
    })

    test('keeps the truncation notice, without its reset code', () => {
        const log = new TestProcessLog()
        const chunk = 'x'.repeat(100_000)
        for (let i = 0; i < Math.ceil(MAX_LOG_CHARS / chunk.length) + 1; i++) {
            log.append(chunk)
        }

        const contents = logFileContents(log)

        assert.ok(contents.startsWith('[earlier output truncated]'))
        assert.ok(TRUNCATION_NOTICE.includes(ESC), 'the notice does carry a reset to strip')
        assert.ok(!contents.includes(ESC))

        log.dispose()
    })
})
