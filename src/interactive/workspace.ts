import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc'
import { notifyTypeReplFinishEval, notifyTypeReplShowInGrid, onExit, onInit } from './repl'

let g_connection: rpc.MessageConnection = null

interface WorkspaceVariable {
    name: string,
    type: string,
    value: string,
    id: any,
    lazy: boolean,
    haschildren: boolean,
    canshow: boolean,
    icon: string
}

const requestTypeGetVariables = new rpc.RequestType<
    void,
    WorkspaceVariable[],
    void, void>('repl/getvariables')

const requestTypeGetLazy = new rpc.RequestType<
    number,
    {
        lazy: boolean,
        id: number,
        head: string,
        haschildren: boolean,
        value: string,
        canshow: boolean,
        icon: string
    }[],
    void, void>('repl/getlazy')

let g_replVariables: WorkspaceVariable[] = []

export class REPLTreeDataProvider implements vscode.TreeDataProvider<WorkspaceVariable> {
    private _onDidChangeTreeData: vscode.EventEmitter<WorkspaceVariable | undefined> = new vscode.EventEmitter<WorkspaceVariable | undefined>();
    readonly onDidChangeTreeData: vscode.Event<WorkspaceVariable | undefined> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined)
    }

    async getChildren(node?: WorkspaceVariable) {
        if (node) {
            const children = await g_connection.sendRequest(requestTypeGetLazy, node.id)

            const out: WorkspaceVariable[] = []

            for (const c of children) {
                out.push({
                    name: c.head,
                    type: '',
                    value: c.value,
                    id: c.id,
                    lazy: c.lazy,
                    haschildren: c.haschildren,
                    canshow: c.canshow,
                    icon: c.icon
                })
            }

            return out
        }
        else {
            return g_replVariables
        }
    }

    getTreeItem(node: WorkspaceVariable): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(node.name)
        treeItem.description = node.value
        treeItem.tooltip = node.type
        treeItem.contextValue = node.canshow ? 'globalvariable' : ''
        treeItem.collapsibleState = node.haschildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        treeItem.iconPath = new vscode.ThemeIcon(node.icon)
        return treeItem
    }
}

let g_REPLTreeDataProvider: REPLTreeDataProvider = null

export async function updateReplVariables() {
    g_replVariables = await g_connection.sendRequest(requestTypeGetVariables, undefined)

    g_REPLTreeDataProvider.refresh()
}

export async function replFinishEval() {
    await updateReplVariables()
}

async function showInVSCode(node: WorkspaceVariable) {
    g_connection.sendNotification(notifyTypeReplShowInGrid, node.name)
}

export function activate(context: vscode.ExtensionContext) {
    g_REPLTreeDataProvider = new REPLTreeDataProvider()
    context.subscriptions.push(vscode.window.registerTreeDataProvider('REPLVariables', g_REPLTreeDataProvider))

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.showInVSCode', showInVSCode))
    context.subscriptions.push(onInit(connection => {
        g_connection = connection
        connection.onNotification(notifyTypeReplFinishEval, replFinishEval)
        updateReplVariables()
    }))
    context.subscriptions.push(onExit(hasError => {
        clearVariables()
    }))
}

export function clearVariables() {
    g_replVariables = []
    g_REPLTreeDataProvider.refresh()
}
