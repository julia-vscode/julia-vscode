import * as assert from 'assert'
import { AnsiStreamSplitter, stripAnsi } from '../../../testing/ansi'

const ESC = '\x1b'
const BEL = '\x07'

/**
 * Feed `input` in as two chunks split at `at`, and check both that nothing was lost and that
 * the first emission ended on an escape sequence boundary.
 *
 * The boundary check is done by stripping each side separately: if the cut had landed inside a
 * sequence, the halves would each keep their fragment and the result would no longer match
 * stripping the whole.
 */
function checkSplit(input: string, at: number) {
    const splitter = new AnsiStreamSplitter()

    const first = splitter.push(input.slice(0, at))
    const second = splitter.push(input.slice(at))
    const tail = splitter.flush()

    assert.strictEqual(first + second + tail, input, `chunks lost splitting at ${at}`)
    assert.ok(input.startsWith(first), `emission is not a prefix, splitting at ${at}`)
    assert.strictEqual(
        stripAnsi(first) + stripAnsi(input.slice(first.length)),
        stripAnsi(input),
        `emitted a partial sequence, splitting at ${at}`
    )
}

suite('AnsiStreamSplitter', () => {
    test('passes text with no escapes straight through', () => {
        const splitter = new AnsiStreamSplitter()
        assert.strictEqual(splitter.push('plain output\n'), 'plain output\n')
        assert.strictEqual(splitter.flush(), '')
    })

    test('holds back a CSI sequence split at any point', () => {
        const input = `before${ESC}[38;5;196mcoloured${ESC}[0mafter`
        for (let at = 0; at <= input.length; at++) {
            checkSplit(input, at)
        }
    })

    test('holds back an OSC hyperlink split at any point', () => {
        const input = `a${ESC}]8;;https://example.com${BEL}link${ESC}]8;;${BEL}b`
        for (let at = 0; at <= input.length; at++) {
            checkSplit(input, at)
        }
    })

    test('holds back an OSC sequence terminated by ST split at any point', () => {
        const input = `a${ESC}]0;title${ESC}\\b`
        for (let at = 0; at <= input.length; at++) {
            checkSplit(input, at)
        }
    })

    test('holds back a two character escape split at any point', () => {
        const input = `a${ESC}Mb`
        for (let at = 0; at <= input.length; at++) {
            checkSplit(input, at)
        }
    })

    test('holds a trailing escape character until more arrives', () => {
        const splitter = new AnsiStreamSplitter()

        assert.strictEqual(splitter.push(`red${ESC}`), 'red')
        assert.strictEqual(splitter.push('[31m'), `${ESC}[31m`)
    })

    test('holds a sequence that arrives one character at a time', () => {
        const splitter = new AnsiStreamSplitter()
        const sequence = `${ESC}[1;31m`

        let emitted = ''
        for (const c of sequence.slice(0, -1)) {
            emitted += splitter.push(c)
        }
        assert.strictEqual(emitted, '', 'nothing may be emitted while the sequence is unfinished')

        assert.strictEqual(splitter.push('m'), sequence)
    })

    test('releases a stray escape rather than stalling the stream', () => {
        const splitter = new AnsiStreamSplitter()

        // Not a sequence at all: `(` is outside every escape's second byte range, so there is
        // nothing to wait for and the text must not be held.
        assert.strictEqual(splitter.push(`a${ESC}(Bb`), `a${ESC}(Bb`)
    })

    test('gives up on a CSI that has grown past any plausible length', () => {
        const splitter = new AnsiStreamSplitter()
        const runaway = `${ESC}[` + '1;'.repeat(100)

        assert.strictEqual(splitter.push(runaway), runaway)
        assert.strictEqual(splitter.flush(), '')
    })

    test('allows an OSC payload far longer than a CSI would be', () => {
        const splitter = new AnsiStreamSplitter()
        const url = 'x'.repeat(500)

        assert.strictEqual(splitter.push(`${ESC}]8;;${url}`), '', 'a long URL is still an unfinished OSC')
        assert.strictEqual(splitter.push(BEL), `${ESC}]8;;${url}${BEL}`)
    })

    test('flush releases an unfinished sequence and empties the buffer', () => {
        const splitter = new AnsiStreamSplitter()

        splitter.push(`done${ESC}[3`)
        assert.strictEqual(splitter.flush(), `${ESC}[3`)
        assert.strictEqual(splitter.flush(), '')
    })

    test('survives a stream chunked at every index of a mixed payload', () => {
        const input = `${ESC}[1mbold${ESC}[22m ${ESC}]8;;http://x${BEL}l${ESC}]8;;${BEL} ${ESC}[K${ESC}Mtail`
        for (let at = 0; at <= input.length; at++) {
            checkSplit(input, at)
        }
    })
})
