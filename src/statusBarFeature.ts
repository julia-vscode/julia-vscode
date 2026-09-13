import * as vscode from 'vscode'
import * as jlpkgenv from './jlpkgenv'
import { LanguageClientFeature, LanguageServerState } from './languageClient'
import { notifyTypePublishServerStatus, PublishServerStatusParams, ServerStatusDJPDetail } from './lsStatusProtocol'
import { handleNewCrashReportFromException } from './telemetry'
import { onEvent } from './utils'

const DJP_KIND_LABELS: Record<string, string> = {
    watch_environment: 'Environment',
    watch_test_environment: 'Test environment',
    create_standalone_project: 'Standalone package',
    resolve_environment: 'Environment resolve',
}

const DJP_STATUS_ICONS: Record<string, string> = {
    queued: '$(watch)',
    preparing: '$(sync~spin)',
    running: '$(sync~spin)',
    refresh_queued: '$(watch)',
    refreshing: '$(sync~spin)',
    done: '$(check)',
    failed: '$(error)',
}

const DJP_STATUS_LABELS: Record<string, string> = {
    queued: 'queued',
    preparing: 'preparing',
    running: 'indexing',
    refresh_queued: 'refresh queued',
    refreshing: 'refreshing',
    done: 'done',
    failed: 'failed',
}

/** At most this many items are listed per group in the flyout. */
const MAX_LISTED_ITEMS = 12

function basename(p: string): string {
    const parts = p.split(/[\\/]/).filter((part) => part.length > 0)
    return parts.length > 0 ? parts[parts.length - 1] : p
}

function djpDisplayName(djp: ServerStatusDJPDetail): string {
    const kind = DJP_KIND_LABELS[djp.kind] ?? djp.kind
    const name = djp.kind === 'watch_test_environment' && djp.package ? djp.package : basename(djp.path)
    return `${kind} \`${name}\``
}

function djpLine(djp: ServerStatusDJPDetail): string {
    const icon = DJP_STATUS_ICONS[djp.status] ?? '$(circle-outline)'
    let line = `${icon} ${djpDisplayName(djp)} — ${DJP_STATUS_LABELS[djp.status] ?? djp.status}`
    if (djp.status === 'running' && djp.progress !== undefined && djp.progress !== null && djp.progress > 0) {
        line += ` ${djp.progress}%`
    }
    if (djp.status === 'failed' && djp.failureMessage) {
        line += `: ${djp.failureMessage.split('\n')[0]}`
    }
    return line
}

/**
 * A persistent Julia status bar item (like the Copilot one): the icon spins
 * with a compact `k/N` counter while the language server starts up or its
 * indexing child processes (DJPs) are still working, and the hover is a
 * flyout detailing exactly what the server is doing — one line per DJP with
 * its state and progress, plus failures and quick actions.
 *
 * The data arrives via the custom `julia/publishServerStatus` notification
 * (see `lsStatusProtocol.ts`), which the server only sends because
 * `julialangServerStatus: true` is passed in the initialization options. An
 * older server never sends it; the item then just reflects the client-known
 * language server state.
 */
export class JuliaStatusBarFeature {
    private statusBarItem: vscode.StatusBarItem
    private lsState: LanguageServerState = 'stopped'
    private serverStatus: PublishServerStatusParams | null = null
    private envName: string | null = null

    constructor(
        private context: vscode.ExtensionContext,
        languageClientFeature: LanguageClientFeature
    ) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            'julia.languageServerStatus',
            vscode.StatusBarAlignment.Right,
            100
        )
        this.statusBarItem.name = 'Julia Language Server'

        this.context.subscriptions.push(
            this.statusBarItem,
            onEvent(languageClientFeature.onDidChangeLsState, (state) => {
                this.lsState = state
                if (state !== 'running') {
                    // Stale DJP details from the previous server instance
                    // must not survive a restart or crash.
                    this.serverStatus = null
                }
                this.refreshEnvName()
                this.render()
            }),
            onEvent(languageClientFeature.onDidSetLanguageClient, (languageClient) => {
                if (!languageClient) {
                    this.serverStatus = null
                    this.render()
                    return
                }
                languageClient.onNotification(notifyTypePublishServerStatus, (params) => {
                    try {
                        this.serverStatus = params
                        this.render()
                    } catch (err) {
                        handleNewCrashReportFromException(err, 'Extension')
                        throw err
                    }
                })
            })
        )

        this.render()
    }

    private refreshEnvName() {
        jlpkgenv.getEnvName().then(
            (name) => {
                if (name !== this.envName) {
                    this.envName = name
                    this.render()
                }
            },
            () => {
                // The environment path can be momentarily unresolvable (e.g.
                // no Julia yet); the flyout simply omits the line.
                this.envName = null
            }
        )
    }

    /** `[settled, total]` of the server's current dynamic work items. */
    private indexingCounts(): [number, number] {
        const djps = this.serverStatus?.djps ?? []
        const settled = djps.filter((djp) => djp.status === 'done' || djp.status === 'failed').length
        return [settled, djps.length]
    }

    private isBusy(): boolean {
        if (this.lsState === 'starting') {
            return true
        }
        if (this.lsState === 'running' && this.serverStatus) {
            return !this.serverStatus.indexingDone
        }
        return false
    }

    private render() {
        if (this.lsState === 'stopped') {
            this.statusBarItem.hide()
            return
        }

        this.statusBarItem.backgroundColor =
            this.lsState === 'crashed' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined
        this.statusBarItem.command =
            this.lsState === 'crashed'
                ? 'language-julia.restartLanguageServer'
                : 'language-julia.showLanguageServerOutput'

        if (this.lsState === 'starting') {
            this.statusBarItem.text = '$(julia-logo~spin) Starting…'
        } else if (this.isBusy()) {
            const [settled, total] = this.indexingCounts()
            this.statusBarItem.text = total > 0 ? `$(julia-logo~spin) ${settled}/${total}` : '$(julia-logo~spin)'
        } else {
            this.statusBarItem.text = '$(julia-logo)'
        }

        this.statusBarItem.tooltip = this.buildFlyout()
        this.statusBarItem.show()
    }

    private buildFlyout(): vscode.MarkdownString {
        const md = new vscode.MarkdownString(undefined, true)
        md.isTrusted = true
        md.supportHtml = true

        const stateLabel =
            this.lsState === 'running'
                ? 'Running'
                : this.lsState === 'starting'
                  ? 'Starting…'
                  : this.lsState === 'crashed'
                    ? '$(warning) Crashed'
                    : 'Stopped'
        md.appendMarkdown(`**Julia Language Server** — ${stateLabel}\n\n`)
        if (this.envName) {
            md.appendMarkdown(`Environment: \`${this.envName}\`\n\n`)
        }

        if (this.lsState === 'crashed') {
            md.appendMarkdown('The language server has crashed. Restart it below and check the logs.\n\n')
        } else if (this.serverStatus) {
            this.appendIndexingSection(md)
        } else if (this.lsState === 'running') {
            // Either the very first status notification is still on its way,
            // or the server predates julia/publishServerStatus.
            md.appendMarkdown('No indexing details reported (yet) by this language server version.\n\n')
        }

        md.appendMarkdown('---\n\n')
        md.appendMarkdown(
            '[Restart Language Server](command:language-julia.restartLanguageServer "Restart the Julia language server") · ' +
                '[Show Output](command:language-julia.showLanguageServerOutput "Open the language server log")\n'
        )
        return md
    }

    private appendIndexingSection(md: vscode.MarkdownString) {
        const status = this.serverStatus
        const djps = status.djps
        const [settled, total] = this.indexingCounts()

        if (status.indexingDone) {
            md.appendMarkdown(
                total > 0
                    ? `$(check) Indexing complete — ${total} ${total === 1 ? 'environment' : 'environments'}\n\n`
                    : '$(check) Indexing complete\n\n'
            )
        } else {
            md.appendMarkdown(`$(sync~spin) Indexing… ${settled} of ${total} environments done\n\n`)
        }

        const active = djps.filter(
            (djp) => djp.status === 'running' || djp.status === 'preparing' || djp.status === 'refreshing'
        )
        const waiting = djps.filter((djp) => djp.status === 'queued' || djp.status === 'refresh_queued')
        const failed = djps.filter((djp) => djp.status === 'failed')
        const processes = djps.filter((djp) => djp.alive).length

        this.appendDjpGroup(md, active)
        this.appendDjpGroup(md, waiting)
        this.appendDjpGroup(md, failed)

        const summary: string[] = []
        const done = djps.filter((djp) => djp.status === 'done').length
        if (done > 0) {
            summary.push(`${done} ${done === 1 ? 'environment' : 'environments'} indexed`)
        }
        if (processes > 0) {
            summary.push(
                `${processes} Julia ${processes === 1 ? 'process' : 'processes'}` +
                    (status.maxConcurrentDjps > 0 ? ` (limit ${status.maxConcurrentDjps})` : '')
            )
        }
        if (summary.length > 0) {
            md.appendMarkdown(summary.join(' · ') + '\n\n')
        }
    }

    private appendDjpGroup(md: vscode.MarkdownString, djps: ServerStatusDJPDetail[]) {
        if (djps.length === 0) {
            return
        }
        for (const djp of djps.slice(0, MAX_LISTED_ITEMS)) {
            md.appendMarkdown(djpLine(djp) + '  \n')
        }
        if (djps.length > MAX_LISTED_ITEMS) {
            md.appendMarkdown(`…and ${djps.length - MAX_LISTED_ITEMS} more  \n`)
        }
        md.appendMarkdown('\n')
    }

    public dispose() {
        // Everything this feature owns is registered on context.subscriptions.
    }
}
