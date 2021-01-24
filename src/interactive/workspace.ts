import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc'
import { notifyTypeReplShowInGrid, onExit, onFinishEval, onInit } from './repl'

let g_connection: rpc.MessageConnection = null

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

let g_replVariables: WorkspaceVariable[] = []

export class REPLTreeDataProvider implements vscode.TreeDataProvider<WorkspaceVariable> {
    private _onDidChangeTreeData: vscode.EventEmitter<WorkspaceVariable | undefined> = new vscode.EventEmitter<WorkspaceVariable | undefined>();
    readonly onDidChangeTreeData: vscode.Event<WorkspaceVariable | undefined> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined)
    }

    async getChildren(node?: WorkspaceVariable) {
        if (node) {
            const children = await g_connection.sendRequest(requestTypeGetLazy, { id: node.id })

            const out: WorkspaceVariable[] = []

            for (const c of children) {
                out.push(c)
            }

            return out
        }
        else {
            return g_replVariables
        }
    }

    getTreeItem(node: WorkspaceVariable): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(node.head)
        treeItem.description = node.value
        treeItem.tooltip = node.type
        treeItem.contextValue = node.canshow ? 'globalvariable' : ''
        treeItem.collapsibleState = node.haschildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        treeItem.iconPath = new vscode.ThemeIcon(node.icon)
        return treeItem
    }
}

let g_REPLTreeDataProvider: REPLTreeDataProvider = null

async function updateReplVariables() {
    g_replVariables = await g_connection.sendRequest(requestTypeGetVariables, undefined)

    g_REPLTreeDataProvider.refresh()
}

async function showInVSCode(node: WorkspaceVariable) {
    g_connection.sendNotification(notifyTypeReplShowInGrid, { code: node.head })
}

export function activate(context: vscode.ExtensionContext) {
    g_REPLTreeDataProvider = new REPLTreeDataProvider()
    context.subscriptions.push(
        // registries
        vscode.window.registerTreeDataProvider('REPLVariables', g_REPLTreeDataProvider),
        // listeners
        onInit(connection => {
            g_connection = connection
            updateReplVariables()
        }),
        onFinishEval(_ => updateReplVariables()),
        onExit(e => clearVariables()),
        // commands
        vscode.commands.registerCommand('language-julia.showInVSCode', showInVSCode),
    )
}

export function clearVariables() {
    g_replVariables = []
    g_REPLTreeDataProvider.refresh()
}
