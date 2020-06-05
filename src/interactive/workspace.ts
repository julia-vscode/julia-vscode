import * as vscode from 'vscode'
import * as repl from './repl'

interface WorkspaceVariable {
    name: string,
    type: string,
    value: string
}

let g_replVariables: WorkspaceVariable[] = []

export class REPLTreeDataProvider implements vscode.TreeDataProvider<WorkspaceVariable> {
    private _onDidChangeTreeData: vscode.EventEmitter<WorkspaceVariable | undefined> = new vscode.EventEmitter<WorkspaceVariable | undefined>();
    readonly onDidChangeTreeData: vscode.Event<WorkspaceVariable | undefined> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined)
    }

    getChildren(node?: WorkspaceVariable) {
        if (node) {
            return []
        }
        else {
            return g_replVariables
        }
    }

    getTreeItem(node: WorkspaceVariable): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(`${node.name}:`)
        treeItem.description = node.value
        treeItem.tooltip = node.type
        treeItem.contextValue = 'globalvariable'
        return treeItem
    }
}

let g_REPLTreeDataProvider: REPLTreeDataProvider = null

export async function updateReplVariables() {
    g_replVariables = await repl.g_connection.sendRequest(repl.requestTypeGetVariables, undefined)

    g_REPLTreeDataProvider.refresh()
}

export async function replFinishEval() {
    await updateReplVariables()
}

async function showInVSCode(node: WorkspaceVariable) {
    repl.g_connection.sendNotification(repl.notifyTypeReplShowInGrid, node.name)
}

export function activate(context: vscode.ExtensionContext) {
    g_REPLTreeDataProvider = new REPLTreeDataProvider()
    context.subscriptions.push(vscode.window.registerTreeDataProvider('REPLVariables', g_REPLTreeDataProvider))

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.showInVSCode', showInVSCode))
}

export function clearVariables() {
    g_replVariables = []
    g_REPLTreeDataProvider.refresh()
}

export function setTerminal(terminal: vscode.Terminal) {
    g_replVariables = []
    g_REPLTreeDataProvider.refresh()
}
