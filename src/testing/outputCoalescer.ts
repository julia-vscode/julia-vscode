/**
 * Batches a stream of small strings into one flush per time window.
 *
 * A chatty test process emits many tiny `testProcessOutput` notifications — one per pipe read —
 * and one `postMessage` per notification swamps the webview on the other end. Coalescing costs
 * one window of latency and turns a burst into a single message.
 *
 * The timer functions are injectable so the tests do not have to sleep.
 */
export class OutputCoalescer {
    private pending: string[] = []
    private timer: unknown = undefined

    constructor(
        private readonly windowMs: number,
        private readonly flush: (text: string) => void,
        private readonly schedule: (cb: () => void, ms: number) => unknown = setTimeout,
        private readonly cancel: (handle: unknown) => void = clearTimeout
    ) {}

    push(text: string) {
        if (text.length === 0) {
            return
        }

        this.pending.push(text)

        if (this.timer === undefined) {
            this.timer = this.schedule(() => {
                this.timer = undefined
                this.flushNow()
            }, this.windowMs)
        }
    }

    /** Emit whatever is buffered right now, cancelling any scheduled flush. */
    flushNow() {
        if (this.timer !== undefined) {
            this.cancel(this.timer)
            this.timer = undefined
        }

        if (this.pending.length === 0) {
            return
        }

        const text = this.pending.join('')
        this.pending = []
        this.flush(text)
    }

    /** Drop anything buffered without emitting it. */
    dispose() {
        if (this.timer !== undefined) {
            this.cancel(this.timer)
            this.timer = undefined
        }
        this.pending = []
    }
}
