import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc'
import { JuliaKernel } from '../notebook/notebookKernel'
import { registerCommand } from '../utils'
import { displayPlot } from './plots'
import { notifyTypeDisplay, notifyTypeReplShowInGrid, onExit, onFinishEval, onInit } from './repl'

// RPC Interface

interface WorkspaceVariable {
    head: string,
    type: string,
    value: string,
    id: number,
    lazy: boolean,
    haschildren: boolean,
    canshow: boolean,
    icon: string
}

const requestTypeGetVariables = new rpc.RequestType<
    void,
    WorkspaceVariable[],
    void>('repl/getvariables')

const requestTypeGetLazy = new rpc.RequestType<
    { id: number },
    WorkspaceVariable[],
    void>('repl/getlazy')

// Different node types

abstract class AbstractWorkspaceNode {
    public abstract getChildren()
}

abstract class SessionNode extends AbstractWorkspaceNode {
    public abstract getConnection()
}

class NotebookNode extends SessionNode {
    private variablesNodes: VariableNode[]

    constructor(private kernel: JuliaKernel, private treeProvider: REPLTreeDataProvider) {
        super()
    }

    public getConnection() {
        return this.kernel._msgConnection
    }

    async updateReplVariables() {
        const variables = await this.kernel._msgConnection.sendRequest(requestTypeGetVariables, undefined)
        this.variablesNodes = variables.map(i => new VariableNode(this, i))

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

class REPLNode extends SessionNode {
    private variablesNodes: VariableNode[]

    constructor(public connection: rpc.MessageConnection, private treeProvider: REPLTreeDataProvider) {
        super()

        onFinishEval(this.updateReplVariables.bind(this))


        this.updateReplVariables()
    }

    public getConnection() {
        return this.connection
    }

    async updateReplVariables() {
        const variables = await this.connection.sendRequest(requestTypeGetVariables, undefined)
        this.variablesNodes = variables.map(i => new VariableNode(this, i))

        this.treeProvider.refresh()
    }

    public async getChildren() {
        return this.variablesNodes
    }
}

class VariableNode extends AbstractWorkspaceNode {
    constructor(private parentREPL: SessionNode, public workspaceVariable: WorkspaceVariable) {
        super()
    }

    public async getChildren() {
        const children = await this.parentREPL.getConnection().sendRequest(requestTypeGetLazy, { id: this.workspaceVariable.id })

        return children.map(i => new VariableNode(this.parentREPL, i))
    }

    public async showInVSCode() {
        this.parentREPL.getConnection().sendNotification(notifyTypeReplShowInGrid, { code: this.workspaceVariable.head })
    }
}

export class WorkspaceFeature {
    _REPLTreeDataProvider: REPLTreeDataProvider

    _REPLNode: REPLNode
    _NotebokNodes: NotebookNode[] = []

    constructor(private context: vscode.ExtensionContext) {
        this._REPLTreeDataProvider = new REPLTreeDataProvider(this)

        this.context.subscriptions.push(
            // registries
            vscode.window.registerTreeDataProvider('REPLVariables', this._REPLTreeDataProvider),
            // listeners
            onInit(this.openREPL.bind(this)),
            onExit(this.closeREPL.bind(this)),
            // commands
            registerCommand('language-julia.showInVSCode', this.showInVSCode.bind(this)),
            registerCommand('language-julia.stopKernel', this.stopKernel.bind(this)),
            registerCommand('language-julia.restartKernel', this.restartKernel.bind(this))
        )
    }

    private openREPL(connection) {
        this._REPLNode = new REPLNode(connection, this._REPLTreeDataProvider)
    }

    private closeREPL(e) {
        this._REPLNode = null
        this._REPLTreeDataProvider.refresh()
    }

    async showInVSCode(node: VariableNode) {
        await node.showInVSCode()
    }

    async stopKernel(node: NotebookNode) {
        node.stop()
    }

    async restartKernel(node: NotebookNode) {
        node.restart()
    }

    public dispose() {
        // this.kernels.dispose()
    }

    public async addNotebookKernel(kernel: JuliaKernel) {
        const node = new NotebookNode(kernel, this._REPLTreeDataProvider)
        this._NotebokNodes.push(node)
        kernel.onCellRunFinished(e => node.updateReplVariables())
        kernel.onConnected(e => {
            kernel._msgConnection.onNotification(notifyTypeDisplay, displayPlot)
            node.updateReplVariables()
        })
        kernel.onStopped(e => {
            const ind = this._NotebokNodes.indexOf(node)
            this._NotebokNodes.splice(ind, 1)
            this._REPLTreeDataProvider.refresh()
        })
        this._REPLTreeDataProvider.refresh()
    }

}

export class REPLTreeDataProvider implements vscode.TreeDataProvider<AbstractWorkspaceNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<AbstractWorkspaceNode | undefined> = new vscode.EventEmitter<AbstractWorkspaceNode | undefined>();
    readonly onDidChangeTreeData: vscode.Event<AbstractWorkspaceNode | undefined> = this._onDidChangeTreeData.event;

    constructor(private workspaceFeautre: WorkspaceFeature) {

    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined)
    }

    async getChildren(node?: AbstractWorkspaceNode) {
        if (node) {
            return await node.getChildren()
        }
        else {
            if (this.workspaceFeautre._REPLNode) {
                return [this.workspaceFeautre._REPLNode, ...this.workspaceFeautre._NotebokNodes]
            }
            else {
                return [...this.workspaceFeautre._NotebokNodes]
            }
        }
    }

    getTreeItem(node: AbstractWorkspaceNode): vscode.TreeItem {
        if (node instanceof VariableNode) {
            const treeItem = new vscode.TreeItem(node.workspaceVariable.head)
            treeItem.description = node.workspaceVariable.value
            treeItem.tooltip = node.workspaceVariable.type
            treeItem.contextValue = node.workspaceVariable.canshow ? 'globalvariable' : ''
            treeItem.collapsibleState = node.workspaceVariable.haschildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
            if (node.workspaceVariable.icon && node.workspaceVariable.icon.length > 0) {
                treeItem.iconPath = new vscode.ThemeIcon(node.workspaceVariable.icon)
            }
            return treeItem
        }
        else if (node instanceof REPLNode) {
            const treeItem = new vscode.TreeItem('Julia REPL')
            treeItem.description = ''
            treeItem.tooltip = ''
            treeItem.contextValue = ''
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
            return treeItem
        }
        else if (node instanceof NotebookNode) {
            const treeItem = new vscode.TreeItem('Julia Notebook kernel')
            treeItem.description = node.getTitle()
            treeItem.tooltip = node.getTitle()
            treeItem.contextValue = 'juliakernel'
            treeItem.collapsibleState = vscode.TreeItemCollapsibleState.Expanded
            return treeItem
        }
    }

}
