import * as vscode from 'vscode'



export function activate(context: vscode.ExtensionContext) {
    return new VersionLensProvider(context)
}


class VersionLensProvider {
    constructor(private context: vscode.ExtensionContext) {
        this.context.subscriptions.push(vscode.languages.registerCodeLensProvider(
            { pattern: '**/Project.toml', language: 'toml' },
            {provideCodeLenses: VersionLensProvider.provideCodeLenses}
        ))
    }

    static provideCodeLenses (document: vscode.TextDocument, token: vscode.CancellationToken) {
        const range = new vscode.Range(document.positionAt(0), document.positionAt(100))
        return [new vscode.CodeLens(range, {title: 'It works', command: '', tooltip: 'It works'})]
    }
}
