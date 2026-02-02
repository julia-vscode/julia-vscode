import * as vscode from 'vscode'
import { ExtensionStatusManager, WorkerInfo, WorkerStatus } from './extensionStatus'

export class StatusPaneTreeItem extends vscode.TreeItem {
    public iconPath?: vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri }
    public description?: string | boolean
    public tooltip?: string | vscode.MarkdownString | undefined

    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly worker?: WorkerInfo
    ) {
        super(label, collapsibleState)

        if (worker) {
            this.updateFromWorker(worker)
        }
    }

    private updateFromWorker(worker: WorkerInfo) {
        // Set icon based on status
        switch (worker.status) {
            case WorkerStatus.Ready:
                this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
                break
            case WorkerStatus.Error:
                this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'))
                break
            case WorkerStatus.Starting:
            case WorkerStatus.Precompiling:
            case WorkerStatus.Indexing:
            case WorkerStatus.DownloadingCache:
                this.iconPath = new vscode.ThemeIcon('loading~spin')
                break
            case WorkerStatus.Blocked:
                this.iconPath = new vscode.ThemeIcon('lock', new vscode.ThemeColor('testing.iconQueued'))
                break
            default:
                this.iconPath = new vscode.ThemeIcon('circle-outline')
        }

        // Set description based on status
        if (worker.message) {
            this.description = worker.message
        } else {
            this.description = this.getStatusLabel(worker.status)
        }

        // Set command to open output log when clicked
        if (worker.name === 'Language Server') {
            this.command = {
                command: 'language-julia.showLanguageServerOutput',
                title: 'Show Language Server Output',
                arguments: []
            }
        }

        // Set tooltip with more details
        const tooltip = new vscode.MarkdownString()
        tooltip.appendMarkdown(`**${worker.name}**\n\n`)
        tooltip.appendMarkdown(`Status: ${this.getStatusLabel(worker.status)}\n\n`)

        if (worker.message) {
            tooltip.appendMarkdown(`${worker.message}\n\n`)
        }

        if (worker.progress) {
            const percentage = Math.round((worker.progress.current / worker.progress.total) * 100)
            tooltip.appendMarkdown(`Progress: ${worker.progress.current}/${worker.progress.total} (${percentage}%)\n\n`)
        }

        if (worker.startTime && worker.status !== WorkerStatus.Ready && worker.status !== WorkerStatus.Error) {
            const elapsed = Math.round((Date.now() - worker.startTime.getTime()) / 1000)
            tooltip.appendMarkdown(`Elapsed: ${elapsed}s\n\n`)
        }

        if (worker.error) {
            tooltip.appendMarkdown(`\n**Error:**\n\`\`\`\n${worker.error}\n\`\`\`\n`)
        }

        this.tooltip = tooltip
    }

    private getStatusLabel(status: WorkerStatus): string {
        switch (status) {
            case WorkerStatus.Idle:
                return 'Idle'
            case WorkerStatus.Starting:
                return 'Starting...'
            case WorkerStatus.Precompiling:
                return 'Precompiling...'
            case WorkerStatus.Indexing:
                return 'Indexing...'
            case WorkerStatus.DownloadingCache:
                return 'Downloading...'
            case WorkerStatus.Ready:
                return 'Ready'
            case WorkerStatus.Error:
                return 'Error'
            case WorkerStatus.Blocked:
                return 'Blocked'
            default:
                return 'Unknown'
        }
    }
}

export class StatusPaneTreeProvider implements vscode.TreeDataProvider<StatusPaneTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<StatusPaneTreeItem | undefined | null | void>()
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event

    constructor(private statusManager: ExtensionStatusManager) {
        statusManager.onDidChangeStatus(() => {
            this._onDidChangeTreeData.fire()
        })
    }

    refresh(): void {
        this._onDidChangeTreeData.fire()
    }

    getTreeItem(element: StatusPaneTreeItem): vscode.TreeItem {
        return element
    }

    getChildren(element?: StatusPaneTreeItem): Promise<StatusPaneTreeItem[]> {
        if (!element) {
            // Root level - show all workers without parents
            const workers = this.statusManager.getAllWorkers()
            const rootWorkers = workers.filter(w => !w.parentId)
            const items = rootWorkers.map(worker => {
                const hasChildren = worker.children && worker.children.size > 0
                const collapsibleState = hasChildren 
                    ? vscode.TreeItemCollapsibleState.Expanded 
                    : vscode.TreeItemCollapsibleState.None
                return new StatusPaneTreeItem(
                    worker.name,
                    collapsibleState,
                    worker
                )
            })

            // Add summary item at the top
            const summaryItem = this.createSummaryItem(workers)
            return Promise.resolve([summaryItem, ...items])
        } else if (element.worker?.children) {
            // Show child workers
            const childItems = Array.from(element.worker.children.values()).map(child => 
                new StatusPaneTreeItem(
                    child.name,
                    vscode.TreeItemCollapsibleState.None,
                    child
                )
            )
            return Promise.resolve(childItems)
        }

        return Promise.resolve([])
    }

    private createSummaryItem(workers: WorkerInfo[]): StatusPaneTreeItem {
        const hasErrors = workers.some(w => w.status === WorkerStatus.Error)
        const isProcessing = workers.some(w =>
            w.status === WorkerStatus.Starting ||
            w.status === WorkerStatus.Precompiling ||
            w.status === WorkerStatus.Indexing ||
            w.status === WorkerStatus.DownloadingCache ||
            w.status === WorkerStatus.Blocked
        )
        const allReady = workers.every(w => w.status === WorkerStatus.Ready || w.status === WorkerStatus.Idle)

        let label: string
        let icon: vscode.ThemeIcon
        let description: string

        if (hasErrors) {
            label = 'Julia Extension Status'
            icon = new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconFailed'))
            description = 'Errors detected - Extension features may not work'
        } else if (isProcessing) {
            label = 'Julia Extension Status'
            icon = new vscode.ThemeIcon('loading~spin')
            const processingWorkers = workers.filter(w => 
                w.status === WorkerStatus.Starting || 
                w.status === WorkerStatus.Precompiling || 
                w.status === WorkerStatus.Indexing ||
                w.status === WorkerStatus.DownloadingCache
            )
            if (processingWorkers.length > 0) {
                const statusMsg = processingWorkers[0].message || this.getStatusText(processingWorkers[0].status)
                description = `${statusMsg} - Features temporarily unavailable`
            } else {
                description = 'Processing - Features temporarily unavailable'
            }
        } else if (allReady) {
            label = 'Julia Extension Status'
            icon = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
            description = 'All features available'
        } else {
            label = 'Julia Extension Status'
            icon = new vscode.ThemeIcon('info')
            description = 'Idle'
        }

        const item = new StatusPaneTreeItem(label, vscode.TreeItemCollapsibleState.None)
        item.iconPath = icon
        item.description = description
        
        // Add command to show output on click
        item.command = {
            command: 'language-julia.showLanguageServerOutput',
            title: 'Show Language Server Output',
            arguments: []
        }

        const tooltip = new vscode.MarkdownString()
        tooltip.appendMarkdown('**Julia Extension Status**\n\n')
        tooltip.appendMarkdown('Click to view language server output\n\n')
        workers.forEach(w => {
            const statusEmoji = this.getStatusEmoji(w.status)
            tooltip.appendMarkdown(`${statusEmoji} ${w.name}: ${this.getStatusText(w.status)}\n`)
        })
        item.tooltip = tooltip

        return item
    }

    private getStatusEmoji(status: WorkerStatus): string {
        switch (status) {
            case WorkerStatus.Ready:
                return '✅'
            case WorkerStatus.Error:
                return '❌'
            case WorkerStatus.Starting:
            case WorkerStatus.Precompiling:
            case WorkerStatus.Indexing:
            case WorkerStatus.DownloadingCache:
                return '⏳'
            case WorkerStatus.Blocked:
                return '🔒'
            default:
                return '⚪'
        }
    }

    private getStatusText(status: WorkerStatus): string {
        switch (status) {
            case WorkerStatus.Idle:
                return 'Idle'
            case WorkerStatus.Starting:
                return 'Starting'
            case WorkerStatus.Precompiling:
                return 'Precompiling'
            case WorkerStatus.Indexing:
                return 'Indexing'
            case WorkerStatus.DownloadingCache:
                return 'Downloading Cache'
            case WorkerStatus.Ready:
                return 'Ready'
            case WorkerStatus.Error:
                return 'Error'
            case WorkerStatus.Blocked:
                return 'Blocked'
            default:
                return 'Unknown'
        }
    }
}
