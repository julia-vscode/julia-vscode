import * as vscode from 'vscode'

export interface ProgressUpdate {
    id: { value: number }
    name: string
    fraction: number
    done: boolean
}

interface ProgressEntry {
    progress: vscode.Progress<{ message?: string; increment?: number }> | null
    lastFraction: number
    started: Date
    resolve: () => void
    lastMessage?: string
    updatedAt?: number
}

export interface ProgressReporterOptions {
    statusBarItem?: vscode.StatusBarItem
    statusBarPrefix?: string
    statusBarCommand?: string
    useWindowProgress?: boolean
}

function formattedTimePeriod(t: number): string {
    const seconds = Math.floor(t % 60)
    const minutes = Math.floor((t / 60) % 60)
    const hours = Math.floor(t / 60 / 60)
    let out = ''
    if (hours > 0) {
        out += `${hours}h, `
    }
    if (minutes > 0) {
        out += `${minutes}min, `
    }
    out += `${seconds}s`
    return out
}

function progressMessage(prog: ProgressUpdate, started: Date | null = null): string {
    let message = prog.name
    const parenthesize = message.trim().length > 0
    if (isFinite(prog.fraction) && 0 <= prog.fraction && prog.fraction <= 1) {
        if (parenthesize) {
            message += ' ('
        }
        message += `${(prog.fraction * 100).toFixed(1)}%`
        if (started !== null) {
            const elapsed = (new Date().valueOf() - started.valueOf()) / 1000
            const remaining = (1 / prog.fraction - 1) * elapsed
            if (isFinite(remaining)) {
                message += ` - ${formattedTimePeriod(remaining)} remaining`
            }
        }
        if (parenthesize) {
            message += ')'
        }
    }
    return message
}

export class ProgressReporter {
    private readonly progressById = new Map<number, ProgressEntry>()
    private readonly statusBarItem?: vscode.StatusBarItem
    private readonly statusBarPrefix: string
    private readonly statusBarCommand?: string
    private readonly useWindowProgress: boolean

    constructor(private readonly onCancel: () => void, options?: ProgressReporterOptions) {
        this.statusBarItem = options?.statusBarItem
        this.statusBarPrefix = options?.statusBarPrefix ?? 'Julia'
        this.statusBarCommand = options?.statusBarCommand
        this.useWindowProgress = options?.useWindowProgress ?? true
    }

    private renderStatusBar(): void {
        if (!this.statusBarItem) {
            return
        }

        if (this.progressById.size === 0) {
            this.statusBarItem.hide()
            return
        }

        const latest = Array.from(this.progressById.values()).reduce<ProgressEntry | undefined>((acc, entry) => {
            if (!acc) {
                return entry
            }
            return (entry.updatedAt ?? 0) > (acc.updatedAt ?? 0) ? entry : acc
        }, undefined)

        const message = latest?.lastMessage ?? ''
        const suffix = message.length > 0 ? `: ${message}` : ''
        this.statusBarItem.text = `$(sync~spin) ${this.statusBarPrefix}${suffix}`
        this.statusBarItem.tooltip = this.statusBarCommand ? 'Interrupt' : undefined
        this.statusBarItem.command = this.statusBarCommand
        this.statusBarItem.show()
    }

    public async handleProgress(progress: ProgressUpdate, startedAt?: Date): Promise<void> {
        const existing = this.progressById.get(progress.id.value)
        if (existing) {
            const increment = progress.done ? 100 : (progress.fraction - existing.lastFraction) * 100
            existing.progress?.report({
                increment,
                message: progressMessage(progress, existing.started),
            })
            existing.lastFraction = progress.fraction
            existing.lastMessage = progressMessage(progress, existing.started)
            existing.updatedAt = Date.now()

            if (progress.done) {
                existing.resolve()
                this.progressById.delete(progress.id.value)
            }

            this.renderStatusBar()
            return
        }

        // When a dedicated status bar is provided and window progress is disabled, keep the
        // reporting lightweight and status-bar-only to avoid duplicate VS Code progress items.
        if (this.statusBarItem && !this.useWindowProgress) {
            const started = startedAt ?? new Date()
            const message = progressMessage(progress, started)
            this.progressById.set(progress.id.value, {
                progress: null,
                lastFraction: progress.fraction,
                started,
                resolve: () => {},
                lastMessage: message,
                updatedAt: Date.now(),
            })

            if (progress.done) {
                this.progressById.delete(progress.id.value)
            }

            this.renderStatusBar()
            return
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: 'Julia',
                cancellable: true,
            },
            (prog, token) => {
                return new Promise<void>((resolve) => {
                    const started = startedAt ?? new Date()
                    const message = progressMessage(progress, started)
                    this.progressById.set(progress.id.value, {
                        progress: prog,
                        lastFraction: progress.fraction,
                        started,
                        resolve,
                        lastMessage: message,
                        updatedAt: Date.now(),
                    })
                    token.onCancellationRequested(() => this.onCancel())
                    prog.report({
                        message,
                    })
                    this.renderStatusBar()
                })
            }
        )
        this.renderStatusBar()
    }

    public startIndeterminate(name = 'Evaluating…', id = -1): void {
        void this.handleProgress({
            name,
            id: { value: id },
            fraction: -1,
            done: false,
        })
    }

    public clear(): void {
        for (const [, entry] of this.progressById) {
            entry.resolve()
        }
        this.progressById.clear()
        if (this.statusBarItem) {
            this.statusBarItem.hide()
        }
    }
}
