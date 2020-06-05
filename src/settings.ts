import * as vscode from 'vscode'

export interface ISettings {
    juliaExePath?: string;
}

export function loadSettings(): ISettings {
    const section = vscode.workspace.getConfiguration('julia')

    let jlpath = section ? section.get<string>('executablePath', null) : null

    if (jlpath === '') {
        jlpath = null
    }

    return {
        juliaExePath: jlpath
    }
}
