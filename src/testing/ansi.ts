/**
 * ANSI escape sequence handling for test process output.
 *
 * Test processes are launched with `--color=yes`, so everything they print — per test item
 * output, process level output, and the failure messages `Test.jl` builds — carries escape
 * sequences. Some of the sinks we feed render them (anything terminal backed) and some do not
 * (`vscode.TestMessage`), so we need both a stripper and, for the streamed sinks, a way to
 * avoid ever cutting a sequence in half.
 */

// The same three patterns TestItemControllers uses in `junit.jl`, and applied in the same
// order: `_ANSI_OTHER` would otherwise swallow the `ESC ]` that opens an OSC sequence and
// leave its payload behind as text.
//
// Matching control characters is the entire job here, so the lint rule against them does not
// apply.
/* eslint-disable no-control-regex */
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const ANSI_CSI = /\x1b\[[0-9;:<=>?]*[ -/]*[@-~]/g
const ANSI_OTHER = /\x1b[@-Z\\-_]/g

/**
 * Remove every escape sequence from `s`.
 *
 * For sinks that render text verbatim — `TestMessage.message`, its expected/actual output and
 * its stack frame labels. Those arrive whole in a single notification payload, so this never
 * has to cope with a sequence split across calls; the streamed paths use
 * {@link AnsiStreamSplitter} instead.
 */
export function stripAnsi(s: string): string {
    return s.replace(ANSI_OSC, '').replace(ANSI_CSI, '').replace(ANSI_OTHER, '')
}

/** A CSI sequence long enough to be certainly malformed rather than merely unfinished. */
const MAX_PENDING_CSI = 64
/** The same for OSC, which legitimately carries a payload (a URL, a window title). */
const MAX_PENDING_OSC = 4096

/** `sequenceAt` could not finish the sequence with the text available so far. */
const INCOMPLETE = -1
/** The bytes after the `ESC` are not a sequence at all, so the `ESC` is just a stray byte. */
const NOT_A_SEQUENCE = -2

/**
 * The index one past the end of the escape sequence starting at `start`, or {@link INCOMPLETE}
 * / {@link NOT_A_SEQUENCE}.
 */
function sequenceAt(s: string, start: number): number {
    if (start + 1 >= s.length) {
        return INCOMPLETE
    }

    const kind = s[start + 1]

    if (kind === '[') {
        let i = start + 2
        while (i < s.length && /[0-9;:<=>?]/.test(s[i])) {
            i++
        }
        while (i < s.length && /[ -/]/.test(s[i])) {
            i++
        }
        if (i >= s.length) {
            return INCOMPLETE
        }
        return /[@-~]/.test(s[i]) ? i + 1 : NOT_A_SEQUENCE
    }

    if (kind === ']') {
        // OSC runs until BEL or ST (`ESC \`), neither of which need be here yet.
        for (let i = start + 2; i < s.length; i++) {
            if (s[i] === '\x07') {
                return i + 1
            }
            if (s[i] === '\x1b') {
                if (i + 1 >= s.length) {
                    return INCOMPLETE
                }
                return s[i + 1] === '\\' ? i + 2 : NOT_A_SEQUENCE
            }
        }
        return INCOMPLETE
    }

    // Two character escapes. `[` and `]` are inside this range but were handled above.
    return /[@-Z\\-_]/.test(kind) ? start + 2 : NOT_A_SEQUENCE
}

/**
 * Splits a stream of output on escape sequence boundaries.
 *
 * `testProcessOutput` is a pipe read, so a chunk can end anywhere — between the `ESC [` and the
 * `31m` of a colour code, or halfway through an OSC hyperlink. Feeding such a chunk straight to
 * xterm is harmless, since its parser holds the partial sequence until the next write, but two
 * things we do downstream are not so forgiving: evicting old chunks from
 * `TestProcessLog` can leave the survivors starting mid sequence, and text we append ourselves
 * inherits whatever colour state was dangling.
 *
 * Pushing through a splitter first makes every chunk we store boundary aligned, so both of
 * those become well defined.
 */
export class AnsiStreamSplitter {
    private pending = ''

    /**
     * Feed `text` in and get back everything that can be emitted without ending inside a
     * sequence. A trailing partial sequence is held until the next `push`, unless it has grown
     * past the point where it could still be one — a stray `ESC` in otherwise binary output
     * must not stall the stream forever.
     */
    push(text: string): string {
        const buf = this.pending + text

        let i = 0
        let incompleteAt = -1
        for (;;) {
            const esc = buf.indexOf('\x1b', i)
            if (esc === -1) {
                break
            }

            const end = sequenceAt(buf, esc)
            if (end === INCOMPLETE) {
                incompleteAt = esc
                break
            }
            // A stray `ESC`: skip just it, there may be a real sequence further along.
            i = end === NOT_A_SEQUENCE ? esc + 1 : end
        }

        if (incompleteAt === -1) {
            this.pending = ''
            return buf
        }

        const held = buf.slice(incompleteAt)
        const cap = held[1] === ']' ? MAX_PENDING_OSC : MAX_PENDING_CSI
        if (held.length > cap) {
            this.pending = ''
            return buf
        }

        this.pending = held
        return buf.slice(0, incompleteAt)
    }

    /** Release the held partial sequence, for when no more input is coming. */
    flush(): string {
        const held = this.pending
        this.pending = ''
        return held
    }
}
