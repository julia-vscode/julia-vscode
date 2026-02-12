import * as vscode from 'vscode'

export enum WorkerStatus {
    Idle = 'idle',
    Starting = 'starting',
    Precompiling = 'precompiling',
    Indexing = 'indexing',
    DownloadingCache = 'downloading',
    Ready = 'ready',
    Error = 'error',
    Blocked = 'blocked'
}

export interface WorkerInfo {
    name: string
    status: WorkerStatus
    message?: string
    startTime?: Date
    error?: string
    progress?: { current: number; total: number }
    children?: Map<string, WorkerInfo>
    parentId?: string
}

export class ExtensionStatusManager {
    private workers: Map<string, WorkerInfo> = new Map()
    private _onDidChangeStatus = new vscode.EventEmitter<void>()
    public readonly onDidChangeStatus = this._onDidChangeStatus.event

    constructor() {
        // Initialize with default workers
        this.workers.set('languageServer', {
            name: 'Language Server',
            status: WorkerStatus.Idle
        })
    }

    public updateWorkerStatus(workerId: string, status: WorkerStatus, message?: string, error?: string, parentId?: string) {
        const worker = this.workers.get(workerId) || {
            name: workerId,
            status: WorkerStatus.Idle
        }

        worker.status = status
        worker.message = message
        if (error) {
            worker.error = error
        }
        if (status === WorkerStatus.Starting || status === WorkerStatus.Precompiling || status === WorkerStatus.Indexing || status === WorkerStatus.DownloadingCache) {
            if (!worker.startTime) {
                worker.startTime = new Date()
            }
        } else if (status === WorkerStatus.Ready || status === WorkerStatus.Error) {
            // Clear start time when done
            worker.startTime = undefined
        }

        if (parentId) {
            worker.parentId = parentId
            const parent = this.workers.get(parentId)
            if (parent) {
                if (!parent.children) {
                    parent.children = new Map()
                }
                parent.children.set(workerId, worker)
            }
        }

        this.workers.set(workerId, worker)
        this._onDidChangeStatus.fire()
    }

    public updateWorkerProgress(workerId: string, current: number, total: number) {
        const worker = this.workers.get(workerId)
        if (worker) {
            worker.progress = { current, total }
            this.workers.set(workerId, worker)
            this._onDidChangeStatus.fire()
        }
    }

    public getWorker(workerId: string): WorkerInfo | undefined {
        return this.workers.get(workerId)
    }

    public getAllWorkers(): WorkerInfo[] {
        return Array.from(this.workers.values())
    }

    public hasErrors(): boolean {
        return Array.from(this.workers.values()).some(w => w.status === WorkerStatus.Error)
    }

    public isBlocked(): boolean {
        return Array.from(this.workers.values()).some(w => 
            w.status === WorkerStatus.Starting || 
            w.status === WorkerStatus.Precompiling || 
            w.status === WorkerStatus.Indexing ||
            w.status === WorkerStatus.DownloadingCache ||
            w.status === WorkerStatus.Blocked
        )
    }

    public removeWorker(workerId: string) {
        const worker = this.workers.get(workerId)
        if (worker?.parentId) {
            const parent = this.workers.get(worker.parentId)
            if (parent?.children) {
                parent.children.delete(workerId)
            }
        }
        this.workers.delete(workerId)
        this._onDidChangeStatus.fire()
    }

    public dispose() {
        this._onDidChangeStatus.dispose()
    }
}
