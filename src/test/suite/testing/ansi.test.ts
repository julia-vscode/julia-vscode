import * as assert from 'assert'
import { stripAnsi } from '../../../testing/ansi'

const ESC = '\x1b'

suite('stripAnsi', () => {
    test('leaves text with no escapes alone', () => {
        assert.strictEqual(stripAnsi(''), '')
        assert.strictEqual(stripAnsi('Test Summary: | Pass  Total\n'), 'Test Summary: | Pass  Total\n')
    })

    test('removes plain SGR colour codes', () => {
        assert.strictEqual(stripAnsi(`${ESC}[31mError${ESC}[39m: boom`), 'Error: boom')
        assert.strictEqual(stripAnsi(`${ESC}[1m${ESC}[22mbold`), 'bold')
        assert.strictEqual(stripAnsi(`${ESC}[0m`), '')
    })

    test('removes 256 colour and truecolor codes', () => {
        assert.strictEqual(stripAnsi(`${ESC}[38;5;196mred${ESC}[0m`), 'red')
        assert.strictEqual(stripAnsi(`${ESC}[38;2;1;2;3mrgb${ESC}[0m`), 'rgb')
        assert.strictEqual(stripAnsi(`${ESC}[48;5;17mbg${ESC}[49m`), 'bg')
    })

    test('removes non-colour CSI sequences', () => {
        // Erase-line, cursor movement and the private-mode sequences a progress bar emits.
        assert.strictEqual(stripAnsi(`Precompiling${ESC}[K`), 'Precompiling')
        assert.strictEqual(stripAnsi(`${ESC}[2A${ESC}[1Gline`), 'line')
        assert.strictEqual(stripAnsi(`${ESC}[?25lhidden${ESC}[?25h`), 'hidden')
    })

    test('removes OSC sequences terminated by BEL', () => {
        assert.strictEqual(stripAnsi(`${ESC}]8;;https://example.com\x07link${ESC}]8;;\x07`), 'link')
    })

    test('removes OSC sequences terminated by ST', () => {
        assert.strictEqual(stripAnsi(`${ESC}]0;a title${ESC}\\after`), 'after')
    })

    test('removes two character escapes', () => {
        assert.strictEqual(stripAnsi(`${ESC}Mreverse index`), 'reverse index')
        assert.strictEqual(stripAnsi(`a${ESC}\\b`), 'ab')
    })

    test('is idempotent', () => {
        const input = `${ESC}[31m${ESC}]8;;http://x\x07a${ESC}[0m`
        const once = stripAnsi(input)
        assert.strictEqual(stripAnsi(once), once)
    })

    test('clears a realistic Test.jl failure block', () => {
        // The shape `Test.jl` produces under `--color=yes`: a bold red header, then a bright
        // expression, then a reset.
        const input =
            `${ESC}[91m${ESC}[1mTest Failed${ESC}[22m${ESC}[39m at ${ESC}[39m${ESC}[1m/x/test.jl:12${ESC}[22m\n` +
            `  Expression: ${ESC}[0m1 == 2\n` +
            `   Evaluated: ${ESC}[0m1 == 2\n`

        const stripped = stripAnsi(input)

        assert.strictEqual(stripped, 'Test Failed at /x/test.jl:12\n  Expression: 1 == 2\n   Evaluated: 1 == 2\n')
        assert.ok(!stripped.includes(ESC), 'no escape character should survive')
    })
})
