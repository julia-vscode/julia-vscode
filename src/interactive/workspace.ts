import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc'
import { JuliaKernel } from '../notebook/notebookKernel'
import { JuliaTestProcess } from '../testing/testFeature'
import { onEvent, registerCommand, wrapCrashReporting } from '../utils'
import { displayPlot } from './plots'
import { notifyTypeDisplay, notifyTypeReplShowInGrid, onExit, onFinishEval, onInit } from './repl'
import { openFile } from './results'

interface Location {
    file: string
    line: number
}

// RPC Interface
interface WorkspaceVariable {
    head: string
    type: string
    value: string
    id: number
    lazy: boolean
    haschildren: boolean
    canshow: boolean
    icon: string
    location?: Location
}

const requestTypeGetVariables = new rpc.RequestType<{ modules: boolean }, WorkspaceVariable[], void>(
    'repl/getvariables'
)

const requestTypeGetLazy = new rpc.RequestType<{ id: number }, WorkspaceVariable[], void>('repl/getlazy')

// Different node types

abstract class AbstractWorkspaceNode {
    public abstract getChildren()
}

abstract class SessionNode extends AbstractWorkspaceNode {
    _showModules: boolean

    constructor() {
        super()

        this._showModules = vscode.workspace.getConfiguration('julia').get('workspace.showModules')
        onEvent(vscode.workspace.onDidChangeConfiguration, (config) => {
            if (config.affectsConfiguration('julia.workspace.showModules')) {
                this._showModules = vscode.workspace.getConfiguration('julia').get('workspace.showModules')
                this.updateReplVariables()
            }
        })
    }

    public toggleModules(show) {
        this._showModules = show
    }

    public abstract getConnection()

    public abstract updateReplVariables()
}

export class NotebookNode extends SessionNode {
    private variablesNodes: VariableNode[]

    constructor(
        private kernel: JuliaKernel,
        private treeProvider: REPLTreeDataProvider
    ) {
        super()
    }

    public getConnection() {
        return this.kernel._msgConnection
    }

    async updateReplVariables() {
        const conn = this.getConnection()
        if (!conn) {
            return
        }
        try {
            const variables = await conn.sendRequest(requestTypeGetVariables, {
                modules: this._showModules,
            })
            this.variablesNodes = variables.map((i) => new VariableNode(this, i))

            this.treeProvider.refresh()
        } catch {
            // Connection may have been disposed
        }
    }

    public async getChildren() {
        return this.variablesNodes
    }

    public getTitle() {
        return this.kernel.notebook.uri.fsPath.toString()
    }

    async restart() {
        await this.kernel.restart()
    }

    async stop() {
        await this.kernel.stop()
    }
}

export type TestControllerState = 'stopped' | 'starting' | 'running'

/**
 * What the controller node needs of `TestFeature` to run its buttons.
 *
 * Declared structurally so `workspace.ts` keeps its import of `testFeature.ts` type only, which
 * is what stops the two modules forming a cycle at runtime.
 */
export interface TestControllerHost {
    startTestController(): Promise<void>
    stopTestController(): Promise<void>
    restartTestController(): Promise<void>
}

/**
 * The controller row in the workspace view.
 *
 * Permanent, unlike the controller it reports on. A controller that dies takes its test
 * processes with it, and their retained logs are exactly what you want to read afterwards — so
 * the node outlives any one controller and holds the process list across restarts.
 */
export class TestControllerNode extends AbstractWorkspaceNode {
    private testProcessNodes: TestProcessNode[] = []
    // Cached rather than rebuilt per query: the tree view tracks expansion state by element
    // identity, so a fresh group node on every refresh would collapse the group as you watch.
    private groupNodes = new Map<TestProcessGroupKind, TestProcessGroupNode>()
    private state: TestControllerState = 'stopped'

    constructor(
        private host: TestControllerHost,
        private treeProvider: REPLTreeDataProvider
    ) {
        super()
    }

    public getState() {
        return this.state
    }

    public setState(state: TestControllerState) {
        if (this.state === state) {
            return
        }

        this.state = state
        this.treeProvider.refresh()
    }

    public hasProcesses() {
        return this.testProcessNodes.length > 0
    }

    addTestProcessNode(node: TestProcessNode) {
        this.testProcessNodes.push(node)
    }

    /** Drop one process and everything it held. Returns whether there was one to drop. */
    public removeProcess(id: string): boolean {
        const node = this.testProcessNodes.find((i) => i.testProcess.id === id)
        if (!node) {
            return false
        }

        this.drop([node])

        return true
    }

    public nodesFor(kind: TestProcessGroupKind) {
        return this.testProcessNodes.filter((i) => i.testProcess.isTerminated() === (kind === 'terminated'))
    }

    /**
     * Drop the terminated processes and everything they were holding on to. Returns their ids,
     * so the caller can close whatever views were open on them.
     */
    public clearTerminated(): string[] {
        const removed = this.nodesFor('terminated')

        this.drop(removed)

        return removed.map((i) => i.testProcess.id)
    }

    /**
     * Take these nodes out of the tree and release what they held.
     *
     * The refresh belongs here rather than at the call site: `clearTerminated` is invoked
     * straight off the group node by its command, with no feature layer in between to redraw.
     */
    private drop(nodes: TestProcessNode[]) {
        if (nodes.length === 0) {
            return
        }

        for (const i of nodes) {
            i.dispose()
            i.testProcess.dispose()
        }
        this.testProcessNodes = this.testProcessNodes.filter((i) => !nodes.includes(i))

        this.treeProvider.refresh()
    }

    // A terminated process keeps its log, so it keeps its node — but mixing the two states in
    // one flat list buries the processes that are actually doing something. Empty groups are
    // omitted, so a session where nothing has died yet looks exactly as it did before.
    public async getChildren() {
        const groups: TestProcessGroupNode[] = []

        for (const kind of ['active', 'terminated'] as TestProcessGroupKind[]) {
            if (this.nodesFor(kind).length === 0) {
                continue
            }

            if (!this.groupNodes.has(kind)) {
                this.groupNodes.set(kind, new TestProcessGroupNode(kind, this))
            }
            groups.push(this.groupNodes.get(kind))
        }

        return groups
    }

    async start() {
        await this.host.startTestController()
    }

    async stop() {
        await this.host.stopTestController()
    }

    async restart() {
        await this.host.restartTestController()
    }
}

export type TestProcessGroupKind = 'active' | 'terminated'

export class TestProcessGroupNode extends AbstractWorkspaceNode {
    constructor(
        public kind: TestProcessGroupKind,
        public controllerNode: TestControllerNode
    ) {
        super()
    }

    public async getChildren() {
        return this.controllerNode.nodesFor(this.kind)
    }
}

export class TestProcessNode extends AbstractWorkspaceNode {
    private subscriptions: vscode.Disposable[]

    constructor(
        public testProcess: JuliaTestProcess,
        private treeProvider: REPLTreeDataProvider
    ) {
        super()

        this.subscriptions = [
            onEvent(testProcess.onStatusChanged, () => this.treeProvider.refresh()),
            // Termination moves the node between groups, which a status refresh alone would not
            // reflect.
            onEvent(testProcess.onTerminated, () => this.treeProvider.refresh()),
        ]
    }

    dispose() {
        for (const i of this.subscriptions) {
            i.dispose()
        }
        this.subscriptions = []
    }

    public async getChildren() {
        return []
    }

    async stop() {
        await this.testProcess.kill()
    }
}

class REPLNode extends SessionNode {
    private variablesNodes: VariableNode[]
    private onEvalHook: vscode.Disposable

    constructor(
        public connection: rpc.MessageConnection,
        private treeProvider: REPLTreeDataProvider
    ) {
        super()

        this.onEvalHook = onFinishEval(() => this.updateReplVariables())

        this.updateReplVariables()
    }

    public getConnection() {
        return this.connection
    }

    public dispose() {
        this.onEvalHook?.dispose()
    }

    async updateReplVariables() {
        const conn = this.getConnection()
        if (!conn) {
            return
        }
        try {
            const variables: WorkspaceVariable[] = await conn.sendRequest(requestTypeGetVariables, {
                modules: this._showModules,
            })
            this.variablesNodes = variables.map((v) => new VariableNode(this, v))

            this.treeProvider.refresh()
        } catch {
            // Connection may have been disposed
        }
    }

    public async getChildren() {
        return this.variablesNodes
    }
}

class VariableNode extends AbstractWorkspaceNode {
    constructor(
        private parentREPL: SessionNode,
        public workspaceVariable: WorkspaceVariable
    ) {
        super()
    }

    public async getChildren() {
        const conn = this.parentREPL.getConnection()
        if (!conn) {
            return []
        }
        try {
            const children: WorkspaceVariable[] = await conn.sendRequest(requestTypeGetLazy, {
                id: this.workspaceVariable.id,
            })

            return children.map((i) => new VariableNode(this.parentREPL, i))
        } catch {
            return []
        }
    }

    public async showInVSCode() {
        const conn = this.parentREPL.getConnection()
        if (!conn) {
            return
        }
        await conn.sendNotification(notifyTypeReplShowInGrid, {
            code: this.workspaceVariable.head,
        })
    }
}

export class WorkspaceFeature {
    _REPLTreeDataProvider: REPLTreeDataProvider

    _REPLNode: REPLNode
    _NotebookNodes: NotebookNode[] = []
    _TestController: TestControllerNode | null = null

    constructor(private context: vscode.ExtensionContext) {
        this._REPLTreeDataProvider = new REPLTreeDataProvider(this)

        this.context.subscriptions.push(
            // registries
            vscode.window.registerTreeDataProvider('REPLVariables', this._REPLTreeDataProvider),
            // listeners
            onInit(wrapCrashReporting(({ connection: conn }) => this.openREPL(conn))),
            onExit(() => this.closeREPL()),
            // commands
            registerCommand('language-julia.showInVSCode', async (node: VariableNode) => await this.showInVSCode(node)),
            registerCommand(
                'language-julia.workspaceGoToFile',
                async (node: VariableNode) => await this.openLocation(node)
            ),
            registerCommand(
                'language-julia.showModules',
                async () => await this._REPLTreeDataProvider.toggleModules(true)
            ),
            registerCommand(
                'language-julia.hideModules',
                async () => await this._REPLTreeDataProvider.toggleModules(false)
            )
        )
    }

    private openREPL(connection) {
        this._REPLNode = new REPLNode(connection, this._REPLTreeDataProvider)
    }

    private closeREPL() {
        this._REPLNode?.dispose()
        this._REPLNode = null
        this._REPLTreeDataProvider.refresh()
    }

    async showInVSCode(node: VariableNode) {
        await node.showInVSCode()
    }

    async openLocation(node: VariableNode) {
        openFile(node.workspaceVariable.location.file, node.workspaceVariable.location.line)
    }

    public dispose() {
        // this.kernels.dispose()
    }

    public async addNotebookKernel(kernel: JuliaKernel) {
        const node = new NotebookNode(kernel, this._REPLTreeDataProvider)
        this._NotebookNodes.push(node)
        kernel.onCellRunFinished(() => node.updateReplVariables())
        kernel.onConnected(() => {
            kernel._msgConnection.onNotification(notifyTypeDisplay, (params) => displayPlot(params, kernel))
            node.updateReplVariables()
        })
        kernel.onStopped(() => {
            this._NotebookNodes = this._NotebookNodes.filter((x) => x !== node)
            this._REPLTreeDataProvider.refresh()
        })
        this._REPLTreeDataProvider.refresh()
    }

    // public async addTestProcess(testProcess: TestProcess) {
    //     const node = new TestProcessNode(testProcess)
    //     this._TestController =
    //     testProcess.onKilled((e) => {
    //         this._TestProcessNodes = this._TestProcessNodes.filter(x => x !==node)
    //         this._REPLTreeDataProvider.refresh()
    //     })
    //     this._REPLTreeDataProvider.refresh()
    // }

    /**
     * Give the workspace view its permanent controller node. Called once, from the `TestFeature`
     * constructor — the workspace feature is built first, so the node cannot be created any
     * earlier than this without leaving its buttons wired to nothing.
     */
    public setTestControllerHost(host: TestControllerHost) {
        this._TestController = new TestControllerNode(host, this._REPLTreeDataProvider)
        this._REPLTreeDataProvider.refresh()
    }

    public setTestControllerState(state: TestControllerState) {
        this._TestController?.setState(state)
    }

    public async addTestProcess(testProcess: JuliaTestProcess) {
        if (!this._TestController) {
            return
        }

        const node = new TestProcessNode(testProcess, this._REPLTreeDataProvider)
        this._TestController.addTestProcessNode(node)
        this._REPLTreeDataProvider.refresh()
    }

    /** Drop one terminated process from the tree. Returns whether there was one to drop. */
    public removeTestProcess(id: string): boolean {
        return this._TestController?.removeProcess(id) ?? false
    }

    // The node is kept — `JuliaTestProcess.markTerminated` has already flipped its state, so
    // this only has to move it into the `Terminated` group by redrawing.
    public async testProcessTerminated() {
        if (!this._TestController) {
            return
        }

        this._REPLTreeDataProvider.refresh()
    }
}

export class REPLTreeDataProvider implements vscode.TreeDataProvider<AbstractWorkspaceNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<AbstractWorkspaceNode | undefined> = new vscode.EventEmitter<
        AbstractWorkspaceNode | undefined
    >()
    readonly onDidChangeTreeData: vscode.Event<AbstractWorkspaceNode | undefined> = this._onDidChangeTreeData.event

    constructor(private workspaceFeature: WorkspaceFeature) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined)
    }

    async getChildren(node?: AbstractWorkspaceNode) {
        if (node) {
            return await node.getChildren()
        } else {
            const nodes: AbstractWorkspaceNode[] = []
            if (this.workspaceFeature._REPLNode) {
                nodes.push(this.workspaceFeature._REPLNode)
            }
            nodes.push(...this.workspaceFeature._NotebookNodes)
            // Always shown, running or not: it is how a controller is started, and how the logs
            // of the processes a dead controller left behind are reached.
            if (this.workspaceFeature._TestController) {
                nodes.push(this.workspaceFeature._TestController)
            }
            return nodes
        }
    }

    getTreeItem(node: AbstractWorkspaceNode): vscode.TreeItem {
        if (node instanceof VariableNode) {
            const treeItem = new vscode.TreeItem(node.workspaceVariable.head)
            treeItem.description = node.workspaceVariable.value
            treeItem.tooltip = node.workspaceVariable.type
            treeItem.contextValue =
                (node.workspaceVariable.canshow ? 'globalvariable' : '') +
                (node.workspaceVariable.location ? ' haslocation' : '')
            treeItem.collapsibleState = node.workspaceVariable.haschildren
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
            if (node.workspaceVariable.icon && node.workspaceVariable.icon.length > 0) {
                treeItem.iconPath = new vscode.ThemeIcon(node.workspaceVariable.icon)
            }
            return treeItem
        } else if (node instanceof REPLNode) {
            const treeItem = new vscode.TreeItem('Julia REPL')
            treeItem.iconPath = new vscode.ThemeIcon('terminal-view-icon')
            treeItem.description = ''
            treeItem.tooltip = ''
            treeItem.contextValue = 'juliarepl'
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
            return treeItem
        } else if (node instanceof NotebookNode) {
            const treeItem = new vscode.TreeItem('Julia Notebook kernel')
            treeItem.iconPath = new vscode.ThemeIcon('notebook')
            treeItem.description = node.getTitle()
            treeItem.tooltip = node.getTitle()
            treeItem.contextValue = 'juliakernel'
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
            return treeItem
        } else if (node instanceof TestProcessGroupNode) {
            const treeItem = new vscode.TreeItem(node.kind === 'active' ? 'Active' : 'Terminated')
            treeItem.contextValue = `juliatestprocessgroup-${node.kind}`
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
            return treeItem
        } else if (node instanceof TestProcessNode) {
            const treeItem = new vscode.TreeItem('Julia Test Process')
            const terminated = node.testProcess.isTerminated()
            const status = node.testProcess.getStatus()
            if (terminated) {
                treeItem.iconPath = new vscode.ThemeIcon('circle-slash')
            } else if (
                status === 'Launching' ||
                status === 'Revising' ||
                status === 'Created' ||
                status === 'Canceling' ||
                status === 'Terminating'
            ) {
                treeItem.iconPath = new vscode.ThemeIcon('gear~spin')
            } else if (status === 'Running') {
                treeItem.iconPath = new vscode.ThemeIcon('loading~spin')
            } else if (status === 'Idle') {
                // treeItem.iconPath = new vscode.ThemeIcon('server-process')
            }

            treeItem.description = node.testProcess.packageName
            treeItem.tooltip = new vscode.MarkdownString(
                `This is a test process for the ${node.testProcess.packageName} package.\n\n` +
                    `**Julia channel:** ${node.testProcess.juliaChannelName ?? 'N/A (no Juliaup)'}\n\n` +
                    `The full package path is ${vscode.Uri.parse(node.testProcess.packageUri).fsPath}\n\n` +
                    `The project path is ${vscode.Uri.parse(node.testProcess.projectUri).fsPath}\n\n` +
                    `The process does ${node.testProcess.coverage ? '' : 'not '}collect coverage information.\n\n` +
                    `The env is ${node.testProcess.env}.`
            )
            // The two states get different context values so that the inline stop button, which
            // is gated on `juliatestprocess`, does not offer to stop something already dead.
            treeItem.contextValue = terminated ? 'juliatestprocess-terminated' : 'juliatestprocess'
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None
            treeItem.command = {
                command: 'language-julia.showTestProcessLog',
                title: 'Show Test Process Log',
                arguments: [node],
            }
            return treeItem
        } else if (node instanceof TestControllerNode) {
            const state = node.getState()
            const presentation = {
                running: { icon: 'test-view-icon', description: 'Running' },
                starting: { icon: 'gear~spin', description: 'Starting…' },
                stopped: { icon: 'debug-disconnect', description: 'Not running' },
            }[state]

            const treeItem = new vscode.TreeItem('Julia Test Item Controller')
            treeItem.iconPath = new vscode.ThemeIcon(presentation.icon)
            treeItem.description = presentation.description
            treeItem.tooltip = new vscode.MarkdownString(
                state === 'running'
                    ? 'The Julia test item controller is running. It is started on demand by a test run, and it owns the test processes below.'
                    : state === 'starting'
                      ? 'The Julia test item controller is starting up.'
                      : 'The Julia test item controller is not running. Any test processes below are from an earlier one; their output is still readable.'
            )
            // The start, stop and restart buttons are each gated on the state they make sense in.
            treeItem.contextValue = `juliatestcontroller-${state}`
            // No twistie at all when there is nothing under it, which is how an idle session
            // looks now that the node is permanent.
            treeItem.collapsibleState = node.hasProcesses()
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.None
            return treeItem
        }
    }

    async toggleModules(show: boolean) {
        this.workspaceFeature._REPLNode.toggleModules(show)
        await this.workspaceFeature._REPLNode.updateReplVariables()
        for (const node of this.workspaceFeature._NotebookNodes) {
            node.toggleModules(show)
            await node.updateReplVariables()
        }
        await vscode.workspace
            .getConfiguration('julia')
            .update('workspace.showModules', show, vscode.ConfigurationTarget.Global)
    }
}
