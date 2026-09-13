import * as lsp from 'vscode-languageserver-protocol'

/**
 * One dynamic work item (DJP = dynamic Julia process) of the language
 * server's JuliaWorkspaces engine. Mirrors `ServerStatusDJPDetail` in
 * LanguageServer.jl; the string unions are open-ended so a newer server can
 * introduce kinds/statuses without breaking an older client.
 */
export interface ServerStatusDJPDetail {
    kind: 'watch_environment' | 'watch_test_environment' | 'create_standalone_project' | 'resolve_environment' | string
    path: string
    package?: string
    status: 'queued' | 'preparing' | 'running' | 'refresh_queued' | 'refreshing' | 'done' | 'failed' | string
    /** Last child-reported indexing percentage, when one exists. */
    progress?: number
    /** User-facing failure sentence for `failed` items, when one exists. */
    failureMessage?: string
    /** Whether a child process for this item is currently alive. */
    alive: boolean
}

export interface PublishServerStatusParams {
    /** Every required work item has settled (the server's `is_ready`). */
    indexingDone: boolean
    pendingCount: number
    maxConcurrentDjps: number
    djps: ServerStatusDJPDetail[]
}

/**
 * Pushed by the language server whenever its dynamic-work state changes.
 * Only sent when the client passed `julialangServerStatus: true` in the
 * initialization options; an older server never sends it at all.
 */
export const notifyTypePublishServerStatus = new lsp.ProtocolNotificationType<PublishServerStatusParams, void>(
    'julia/publishServerStatus'
)
