import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc'
import { JuliaKernel } from '../notebook/notebookKernel'
import { JuliaTestController, JuliaTestProcess } from '../testing/testFeature'
import { registerCommand, wrapCrashReporting } from '../utils'
import { displayPlot } from './plots'
import {
    notifyTypeDisplay,
    notifyTypeReplShowInGrid,
    onExit,
    onFinishEval,
    onInit,
} from './repl'
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

const requestTypeGetVariables = new rpc.RequestType<
    { modules: boolean },
    WorkspaceVariable[],
    void
>('repl/getvariables')

const requestTypeGetLazy = new rpc.RequestType<
    { id: number },
    WorkspaceVariable[],
    void
>('repl/getlazy')

// Different node types

abstract class AbstractWorkspaceNode {
    public abstract getChildren()
}

abstract class SessionNode extends AbstractWorkspaceNode {
    _showModules: boolean

    constructor() {
        super()

        this._showModules = vscode.workspace.getConfiguration('julia').get('workspace.showModules')
        vscode.workspace.onDidChangeConfiguration(config => {
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
        const variables = await this.kernel._msgConnection.sendRequest(
            requestTypeGetVariables,
            { modules: this._showModules }
        )
        this.variablesNodes = variables.map((i) => new VariableNode(this, i))

        this.treeProvider.refresh()
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

export class TestControllerNode extends AbstractWorkspaceNode {
    private testProcessNodes: TestProcessNode[] = []

    constructor(
        public testController: JuliaTestController) {
        super()
    }

    addTestProcessNode(node: TestProcessNode) {
        this.testProcessNodes.push(node)
    }

    removeTestProcessNode(id: string) {
        this.testProcessNodes = this.testProcessNodes.filter(i=>i.testProcess.id !== id)
    }

    public async getChildren() {
        return this.testProcessNodes
    }

    async stop() {
        await this.testController.kill()
    }
}

export class TestProcessNode extends AbstractWorkspaceNode {
    constructor(
        public testProcess: JuliaTestProcess,
        private treeProvider: REPLTreeDataProvider) {
        super()

        testProcess.onStatusChanged(e => {
            this.treeProvider.refresh()
        })
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
        const variables: WorkspaceVariable[] =
            await this.getConnection().sendRequest(
                requestTypeGetVariables,
                { modules: this._showModules }
            )
        this.variablesNodes = variables.map((v) => new VariableNode(this, v))

        this.treeProvider.refresh()
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
        const children: WorkspaceVariable[] = await this.parentREPL
            .getConnection()
            .sendRequest(requestTypeGetLazy, { id: this.workspaceVariable.id })

        return children.map((i) => new VariableNode(this.parentREPL, i))
    }

    public async showInVSCode() {
        await this.parentREPL
            .getConnection()
            .sendNotification(notifyTypeReplShowInGrid, {
                code: this.workspaceVariable.head,
            })
    }
}

export class WorkspaceFeature {
    _REPLTreeDataProvider: REPLTreeDataProvider

    _REPLNode: REPLNode
    _NotebookNodes: NotebookNode[] = []
    _TestController: TestControllerNode | null

    constructor(private context: vscode.ExtensionContext) {
        this._REPLTreeDataProvider = new REPLTreeDataProvider(this)

        this.context.subscriptions.push(
            // registries
            vscode.window.registerTreeDataProvider(
                'REPLVariables',
                this._REPLTreeDataProvider
            ),
            // listeners
            onInit(wrapCrashReporting(conn => this.openREPL(conn))),
            onExit((err) => this.closeREPL(err)),
            // commands
            registerCommand('language-julia.showInVSCode', (node: VariableNode) =>
                this.showInVSCode(node)
            ),
            registerCommand('language-julia.workspaceGoToFile', (node: VariableNode) =>
                this.openLocation(node)
            ),
            registerCommand('language-julia.showModules', () =>
                this._REPLTreeDataProvider.toggleModules(true)
            ),
            registerCommand('language-julia.hideModules', () =>
                this._REPLTreeDataProvider.toggleModules(false)
            )
        )
    }

    private openREPL(connection) {
        this._REPLNode = new REPLNode(connection, this._REPLTreeDataProvider)
    }

    private closeREPL(err) {
        this._REPLNode.dispose()
        this._REPLNode = null
        this._REPLTreeDataProvider.refresh()
    }

    async showInVSCode(node: VariableNode) {
        await node.showInVSCode()
    }

    async openLocation(node: VariableNode) {
        openFile(
            node.workspaceVariable.location.file,
            node.workspaceVariable.location.line
        )
    }

    public dispose() {
        // this.kernels.dispose()
    }

    public async addNotebookKernel(kernel: JuliaKernel) {
        const node = new NotebookNode(kernel, this._REPLTreeDataProvider)
        this._NotebookNodes.push(node)
        kernel.onCellRunFinished((e) => node.updateReplVariables())
        kernel.onConnected((e) => {
            kernel._msgConnection.onNotification(notifyTypeDisplay, (params) => displayPlot(params, kernel))
            node.updateReplVariables()
        })
        kernel.onStopped((e) => {
            this._NotebookNodes = this._NotebookNodes.filter(x => x !== node)
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

    public async addTestController(testController: JuliaTestController) {
        const node = new TestControllerNode(testController)
        this._TestController = node
        // testController.onKilled((e) => {
        //     this._TestController = null
        //     this._REPLTreeDataProvider.refresh()
        // })
        this._REPLTreeDataProvider.refresh()
    }

    public async addTestProcess(testProcess: JuliaTestProcess) {
        const node = new TestProcessNode(testProcess, this._REPLTreeDataProvider)
        this._TestController.addTestProcessNode(node)
        this._REPLTreeDataProvider.refresh()
    }

    public async removeTestProcess(testProcess: JuliaTestProcess) {
        this._TestController.removeTestProcessNode(testProcess.id)
        this._REPLTreeDataProvider.refresh()
    }
}

export class REPLTreeDataProvider
implements vscode.TreeDataProvider<AbstractWorkspaceNode>
{
    private _onDidChangeTreeData: vscode.EventEmitter<
        AbstractWorkspaceNode | undefined
    > = new vscode.EventEmitter<AbstractWorkspaceNode | undefined>()
    readonly onDidChangeTreeData: vscode.Event<
        AbstractWorkspaceNode | undefined
    > = this._onDidChangeTreeData.event

    constructor(private workspaceFeature: WorkspaceFeature) { }

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
            treeItem.contextValue = (node.workspaceVariable.canshow ? 'globalvariable' : '') + (
                node.workspaceVariable.location ? ' haslocation' : '')
            treeItem.collapsibleState = node.workspaceVariable.haschildren
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None
            if (
                node.workspaceVariable.icon &&
                node.workspaceVariable.icon.length > 0
            ) {
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
        } else if (node instanceof TestProcessNode) {
            const treeItem = new vscode.TreeItem('Julia Test Process')
            const status = node.testProcess.getStatus()
            if( status === 'Launching' || status === 'Revising' || status === 'Created' || status === 'Canceling') {
                treeItem.iconPath = new vscode.ThemeIcon('gear~spin')
            } else if(status === 'Running') {
                treeItem.iconPath = new vscode.ThemeIcon('loading~spin')
            } else if (status === 'Idle') {
                // treeItem.iconPath = new vscode.ThemeIcon('server-process')
            } else {

            }
            // treeItem.description = node.testProcess.packageName
            // treeItem.tooltip = new vscode.MarkdownString(`This is a test process for the ${node.testProcess.packageName} package.\n\nThe full package path is ${vscode.Uri.parse(node.testProcess.package_uri).fsPath}\n\nThe project path is ${vscode.Uri.parse(node.testProcess.project_uri).fsPath}\n\nThe process does ${node.testProcess.coverage ? '' : 'not'} collect coverage information.`)
            treeItem.contextValue = 'juliatestprocess'
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None
            return treeItem
        } else if (node instanceof TestControllerNode) {
            const treeItem = new vscode.TreeItem('Julia Test Item Controller')
            treeItem.iconPath = new vscode.ThemeIcon('test-view-icon')
            // treeItem.description = node.testProcess.packageName
            // treeItem.tooltip = new vscode.MarkdownString(`This is a test process for the ${node.testProcess.packageName} package.\n\nThe full package path is ${vscode.Uri.parse(node.testProcess.package_uri).fsPath}\n\nThe project path is ${vscode.Uri.parse(node.testProcess.project_uri).fsPath}\n\nThe process does ${node.testProcess.coverage ? '' : 'not'} collect coverage information.`)
            treeItem.contextValue = 'juliatestcontroller'
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
            return treeItem
        }
    }

    toggleModules(show: boolean) {
        this.workspaceFeature._REPLNode.toggleModules(show)
        this.workspaceFeature._REPLNode.updateReplVariables()
        this.workspaceFeature._NotebookNodes.forEach(node => {
            node.toggleModules(show)
            node.updateReplVariables()
        })
        vscode.workspace.getConfiguration('julia').update('workspace.showModules', show, vscode.ConfigurationTarget.Global)
    }
}
