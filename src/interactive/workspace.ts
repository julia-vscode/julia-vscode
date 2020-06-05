import * as vscode from 'vscode';
import * as rpc from 'vscode-jsonrpc';
import * as repl from './repl';

interface WorkspaceVariable {
    name: string,
    type: string,
    value: string,
    id: any,
    lazy: boolean
}

const requestTypeGetVariables = new rpc.RequestType<
    void,
    WorkspaceVariable[],
    void, void>('repl/getvariables')

const requestTypeGetLazy = new rpc.RequestType<
    void,
    {
        lazy: boolean,
        id: number,
        head: string
    }[],
    void, void>('repl/getlazy');

let g_replVariables: WorkspaceVariable[] = [];

export class REPLTreeDataProvider implements vscode.TreeDataProvider<WorkspaceVariable> {
    private _onDidChangeTreeData: vscode.EventEmitter<WorkspaceVariable | undefined> = new vscode.EventEmitter<WorkspaceVariable | undefined>();
    readonly onDidChangeTreeData: vscode.Event<WorkspaceVariable | undefined> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getChildren(node?: WorkspaceVariable): Thenable<WorkspaceVariable[]> {
        if (node) {
            return new Promise(resolve => {
                const pr = repl.g_connection.sendRequest(requestTypeGetLazy, node.id)
                pr.then(children => {
                    const out: WorkspaceVariable[] = []
                    for (const c of children) {
                        out.push({
                            name: c.head,
                            type: '',
                            value: '',
                            id: c.id,
                            lazy: c.lazy
                        })
                    }
                    resolve(out)
                })
            })
        }
        else {
            return Promise.resolve(g_replVariables)
        }
    }

    getTreeItem(node: WorkspaceVariable): vscode.TreeItem {
        let treeItem = new vscode.TreeItem(node.name)
        treeItem.description = node.value;
        treeItem.tooltip = node.type;
        treeItem.contextValue = 'globalvariable';
        treeItem.collapsibleState = node.lazy ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        return treeItem;
    }
}

let g_REPLTreeDataProvider: REPLTreeDataProvider = null;

export async function updateReplVariables() {
    g_replVariables = await repl.g_connection.sendRequest(requestTypeGetVariables, undefined);

    g_REPLTreeDataProvider.refresh();
}

export async function replFinishEval() {
    await updateReplVariables();
}

async function showInVSCode(node: WorkspaceVariable) {
    repl.g_connection.sendNotification(repl.notifyTypeReplShowInGrid, node.name);
}

export function activate(context: vscode.ExtensionContext) {
    g_REPLTreeDataProvider = new REPLTreeDataProvider();
    context.subscriptions.push(vscode.window.registerTreeDataProvider('REPLVariables', g_REPLTreeDataProvider));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.showInVSCode', showInVSCode));
}

export function clearVariables() {
    g_replVariables = [];
    g_REPLTreeDataProvider.refresh();
}

export function setTerminal(terminal: vscode.Terminal) {
    g_replVariables = [];
    g_REPLTreeDataProvider.refresh();
}
