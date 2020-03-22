import * as vscode from 'vscode';
const node_ssh = require('node-ssh');

export async function foo() {
    const ssh = new node_ssh();

    let password = await vscode.window.showInputBox();

    await ssh.connect({
        host: 'hpc.brc.berkeley.edu',
        username: 'anthoff',
        password: password,
        tryKeyboard: true,
        onKeyboardInteractive: (name, instructions, instructionsLang, prompts, finish) => {
            if (prompts.length > 0 && prompts[0].prompt.toLowerCase().includes('password')) {
                finish([password])
            }
        }
    });

    let res = await ssh.execCommand('module load julia/1.3.1 && julia --version');

    console.log(res);
}