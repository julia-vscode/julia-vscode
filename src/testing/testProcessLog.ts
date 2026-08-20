import * as vscode from 'vscode'
import { AnsiStreamSplitter, stripAnsi } from './ansi'

/**
 * How much output we keep per test process. Processes are now retained after they die so that
 * their log stays readable, and nothing bounds how much a runaway test prints, so the buffer
 * has to bound itself. Counted in UTF-16 units rather than bytes — near enough for a cap whose
 * only job is to stop one process eating the window.
 */
export const MAX_LOG_CHARS = 5_000_000

/** Prepended to a truncated log. The reset discards colour state left by the dropped prefix. */
export const TRUNCATION_NOTICE = '\x1b[0m[earlier output truncated]\r\n'

/**
 * The retained output of a single test process.
 *
 * Text arrives in whatever chunks the pipe produced, so it is pushed through an
 * {@link AnsiStreamSplitter} on the way in. That makes every stored chunk end on an escape
 * sequence boundary, which is what makes dropping whole chunks for the size cap safe: the
 * survivors can never begin halfway through a colour code.
 */
export class TestProcessLog implements vscode.Disposable {
    private chunks: string[] = []
    private totalChars = 0
    private truncated = false
    private splitter = new AnsiStreamSplitter()

    private _onDidAppend = new vscode.EventEmitter<string>()
    public readonly onDidAppend = this._onDidAppend.event

    /** Feed process output in. Fires `onDidAppend` with the part that could be emitted. */
    append(text: string) {
        this.store(this.splitter.push(text))
    }

    /**
     * Append text of our own — a footer, a diagnostic — after releasing whatever partial
     * sequence the stream ended on, so ours is not swallowed by it.
     */
    finish(text: string) {
        this.store(this.splitter.flush() + text)
    }

    private store(text: string) {
        if (text.length === 0) {
            return
        }

        this.chunks.push(text)
        this.totalChars += text.length

        while (this.totalChars > MAX_LOG_CHARS && this.chunks.length > 1) {
            this.totalChars -= this.chunks.shift().length
            this.truncated = true
        }

        this._onDidAppend.fire(text)
    }

    /** Everything retained, ready to be replayed into a freshly opened view. */
    getFullText(): string {
        return (this.truncated ? TRUNCATION_NOTICE : '') + this.chunks.join('')
    }

    /** Whether output was dropped to stay under the size cap. */
    isTruncated() {
        return this.truncated
    }

    dispose() {
        this.chunks = []
        this.totalChars = 0
        this._onDidAppend.dispose()
    }
}

/**
 * What gets written when a log is saved to disk.
 *
 * Stripped rather than verbatim: a saved log is opened in an editor far more often than it is
 * replayed through a terminal, and `[32m` noise on every line makes it unreadable there.
 */
export function logFileContents(log: TestProcessLog): string {
    return stripAnsi(log.getFullText())
}
