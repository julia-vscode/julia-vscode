import * as vscode from 'vscode';
import * as rpc from 'vscode-jsonrpc';
import { onInit, onExit, notifyTypeReplShowInGrid } from './repl';
import { selectModule, getModuleForEditor } from './modules';

let workspaceModule = 'Main'
let g_connection: rpc.MessageConnection = null

const FOLLOW_OPTION = 'Follow editor'

interface WorkspaceVariable {
    name: string,
    type: string,
    value: string
}

let g_replVariables: WorkspaceVariable[] = [];

export class REPLTreeDataProvider implements vscode.TreeDataProvider<WorkspaceVariable> {
    private _onDidChangeTreeData: vscode.EventEmitter<WorkspaceVariable | undefined> = new vscode.EventEmitter<WorkspaceVariable | undefined>();
    readonly onDidChangeTreeData: vscode.Event<WorkspaceVariable | undefined> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
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
        let treeItem = new vscode.TreeItem(`${node.name}:`)
        treeItem.description = node.value;
        treeItem.tooltip = node.type;
        treeItem.contextValue = 'globalvariable';
        return treeItem;
    }
}

let g_REPLTreeDataProvider: REPLTreeDataProvider = null;

export const requestTypeGetVariables = new rpc.RequestType<
    string,
    { name: string, type: string, value: any }[],
    void, void
>('repl/getvariables');

export async function updateWorkspace() {
    const mod = workspaceModule === FOLLOW_OPTION ?
        await getModuleForEditor() :
        workspaceModule
    g_replVariables = await g_connection.sendRequest(requestTypeGetVariables, mod);
    g_REPLTreeDataProvider.refresh();
}

export async function replFinishEval() {
    await updateWorkspace();
}

async function chooseWorkspaceModule() {
    workspaceModule = await selectModule(FOLLOW_OPTION)
    updateWorkspace()
}

async function showInVSCode(node: WorkspaceVariable) {
    g_connection.sendNotification(notifyTypeReplShowInGrid, node.name);
}

export function activate(context: vscode.ExtensionContext) {
    g_REPLTreeDataProvider = new REPLTreeDataProvider()
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('julia-workspace', g_REPLTreeDataProvider),
        vscode.commands.registerCommand('language-julia.chooseWorkspaceModule', chooseWorkspaceModule),
        vscode.commands.registerCommand('language-julia.showInVSCode', showInVSCode),
        onInit(connection => {
            g_connection = connection
            updateWorkspace()
        }),
        onExit(hadError => {
            clearVariables()
        })
    )
}

export function clearVariables() {
    g_replVariables = [];
    g_REPLTreeDataProvider.refresh();
}
