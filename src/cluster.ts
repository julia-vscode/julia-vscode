import * as vscode from 'vscode';
import * as path from 'path'
const node_ssh = require('node-ssh');

let g_context: vscode.ExtensionContext = undefined;

class ClusterConnection {
    ssh_ctrl: any;
    ssh_dt: any;

    async connect(password: string) {
        const ssh_ctrl = new node_ssh();
        const ssh_dt = new node_ssh();
    
        await ssh_ctrl.connect({
            host: '',
            username: '',
            password: password,
            tryKeyboard: true,
            onKeyboardInteractive: (name, instructions, instructionsLang, prompts, finish) => {
                if (prompts.length > 0 && prompts[0].prompt.toLowerCase().includes('password')) {
                    finish([password])
                }
            }
        });
    
        await ssh_dt.connect({
            host: '',
            username: '',
            password: password,
            tryKeyboard: true,
            onKeyboardInteractive: (name, instructions, instructionsLang, prompts, finish) => {
                if (prompts.length > 0 && prompts[0].prompt.toLowerCase().includes('password')) {
                    finish([password])
                }
            }
        });

        this.ssh_ctrl = ssh_ctrl;
        this.ssh_dt = ssh_dt;
    }
}

let g_connection: ClusterConnection = undefined;

export async function foo() {

    let password = await vscode.window.showInputBox();

    let conn = new ClusterConnection();

    conn.connect(password);

    g_connection = conn;
   

    // let res = await ssh.execCommand('module load julia/1.3.1 && julia clusterserver.jl');

    // console.log(res);
}

export async function transferData() {
    let sourcePath = path.join(g_context.extensionPath, 'scripts', 'clusterserver', 'clusterserver.jl');

    try {
        await g_connection.ssh_dt.putFile(sourcePath, 'clusterserver.jl');
    }
    catch (err) {
        console.log(err);
    }
}

export function init(context) {
    g_context = context;
}