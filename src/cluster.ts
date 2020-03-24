import * as vscode from 'vscode';
import * as path from 'path'
const node_ssh = require('node-ssh');

let g_context: vscode.ExtensionContext = undefined;
let g_treeprovider: ClusterTreeDataProvider = undefined;
let g_connection: Array<ClusterConnection> = [];

class ClusterConnection {
    constructor(
        public name: string,
        public username: string,
        public host: string,
        public dthost: string
    ) {}

    ssh_ctrl: any;
    ssh_dt: any;

    

    async connect(password: string) {
        const ssh_ctrl = new node_ssh();
        const ssh_dt = new node_ssh();
    
        await ssh_ctrl.connect({
            host: this.host,
            username: this.username,
            password: password,
            tryKeyboard: true,
            onKeyboardInteractive: (name, instructions, instructionsLang, prompts, finish) => {
                if (prompts.length > 0 && prompts[0].prompt.toLowerCase().includes('password')) {
                    finish([password])
                }
            }
        });
    
        // await ssh_dt.connect({
        //     host: '',
        //     username: '',
        //     password: password,
        //     tryKeyboard: true,
        //     onKeyboardInteractive: (name, instructions, instructionsLang, prompts, finish) => {
        //         if (prompts.length > 0 && prompts[0].prompt.toLowerCase().includes('password')) {
        //             finish([password])
        //         }
        //     }
        // });

        this.ssh_ctrl = ssh_ctrl;
        // this.ssh_dt = ssh_dt;
    }
}

class ClusterTreeItem {}

class ClusterTreeItemConnection extends ClusterTreeItem {
    constructor(
        public connection: ClusterConnection
    ) {
        super();
    }
}

class ClusterTreeItemJobs extends ClusterTreeItem {
    constructor() {
        super();
    }
}

class ClusterTreeDataProvider implements vscode.TreeDataProvider<ClusterTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ClusterTreeItem | undefined> = new vscode.EventEmitter<ClusterTreeItem | undefined>();
    readonly onDidChangeTreeData: vscode.Event<ClusterTreeItem | undefined> = this._onDidChangeTreeData.event;

    refresh(node?: ClusterTreeItem): void {
        this._onDidChangeTreeData.fire(node);
    }

    getChildren(node?: ClusterTreeItem) {
        if (!node) {
            return g_connection.map(i=>new ClusterTreeItemConnection(i));
        }
        else if(node instanceof ClusterTreeItemConnection) {
            if (node.connection.ssh_ctrl) {
                return [new ClusterTreeItemJobs()]
            }
            else {
                return [];
            }
        }
        else {
            return []
        }
    }

    getTreeItem(node: ClusterTreeItem): vscode.TreeItem {
        if (node instanceof ClusterTreeItemConnection) {
            let item =  new vscode.TreeItem(`${node.connection.name}${node.connection.ssh_ctrl ? ' (connected)' : ''}`);
            item.contextValue = node.connection.ssh_ctrl ? 'connectionopen' : 'connectionclosed';
            item.collapsibleState = node.connection.ssh_ctrl ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
            return item;
        }
        else if (node instanceof ClusterTreeItemJobs) {
            return new vscode.TreeItem('Jobs');
        }
    }
}

export async function connect(conn: ClusterTreeItemConnection) {
    let password = await vscode.window.showInputBox();

    await conn.connection.connect(password);

    g_treeprovider.refresh(conn);
    // let res = await ssh.execCommand('module load julia/1.3.1 && julia clusterserver.jl');

    // console.log(res);
}

async function disconnect(conn: ClusterTreeItemConnection) {
    await conn.connection.ssh_ctrl.dispose();

    conn.connection.ssh_ctrl = undefined;

    g_treeprovider.refresh(conn);
}

export async function transferData() {
    // let sourcePath = path.join(g_context.extensionPath, 'scripts', 'clusterserver', 'clusterserver.jl');

    // try {
    //     await g_connection.ssh_dt.putFile(sourcePath, 'clusterserver.jl');
    // }
    // catch (err) {
    //     console.log(err);
    // }
}

export function init(context) {
    g_context = context;

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.sshconnect', connect));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.sshdisconnect', disconnect));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.sshupload', transferData));


    let config_data = vscode.workspace.getConfiguration('julia').get<Array<any>>('cluster.connections');

    g_connection = config_data.map(i=>new ClusterConnection(i.name, i.username, i.host, i.dthost));

    g_treeprovider = new ClusterTreeDataProvider();

    // g_treeview  = vscode.window.createTreeView('julia-clusters', {treeDataProvider: g_treeprovider});

    // g_treeview.message = 'here is some em';

    context.subscriptions.push(vscode.window.registerTreeDataProvider('julia-clusters', g_treeprovider));
}