import * as vscode from 'vscode';

let g_terminal: vscode.Terminal = null
let g_replVariables: string = '';

export class REPLTreeDataProvider implements vscode.TreeDataProvider<string> {
    private _onDidChangeTreeData: vscode.EventEmitter<string | undefined> = new vscode.EventEmitter<string | undefined>();
    readonly onDidChangeTreeData: vscode.Event<string | undefined> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getChildren(node?: string) {
        if (node) {
            return [node]
        }
        else {
            if (g_terminal) {
                return g_replVariables.split(';').slice(1)
            }
            else {
                return ['no repl attached']
            }
        }
    }

    getTreeItem(node: string): vscode.TreeItem {
        let treeItem: vscode.TreeItem = new vscode.TreeItem(node)
        return treeItem;
    }
}

// TODO Enable again
// let g_REPLTreeDataProvider: REPLTreeDataProvider = null;

export function activate(context: vscode.ExtensionContext) {
    // TODO Enable again
    // g_REPLTreeDataProvider = new REPLTreeDataProvider();
    // context.subscriptions.push(vscode.window.registerTreeDataProvider('REPLVariables', g_REPLTreeDataProvider));
}

export function setTerminal(terminal: vscode.Terminal) {
    g_terminal = terminal
}
