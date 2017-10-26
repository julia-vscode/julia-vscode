import * as vscode from 'vscode';

export interface ISettings {
    juliaExePath?: string;
}

export function loadSettings(): ISettings {
    let section = vscode.workspace.getConfiguration('julia');

    return {
        juliaExePath: section ? section.get<string>('executablePath', null) : null
    };
}
