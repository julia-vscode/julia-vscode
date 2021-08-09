import * as toml from '@iarna/toml'
import * as vscode from 'vscode'



export function activate(context: vscode.ExtensionContext) {
    return new VersionLensProvider(context)
}


class VersionLensProvider {
    constructor(private context: vscode.ExtensionContext) {
        this.context.subscriptions.push(vscode.languages.registerCodeLensProvider(
            { pattern: '**/Project.toml', language: 'toml' },
            { provideCodeLenses: VersionLensProvider.provideCodeLenses },
        ))
    }

    static provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken) {
        const deps = VersionLensProvider.parseProjectTomlDocument(document)
        const ranges = VersionLensProvider.getPositions(document, deps)
        return ranges.map(range =>
            new vscode.CodeLens(range, { title: 'It works', command: '', tooltip: 'It works' })
        )
    }

    static parseProjectTomlDocument(document: vscode.TextDocument) {
        const documentText = document.getText()
        const { deps } = toml.parse(documentText)
        return deps
    }

    static getPositions(document: vscode.TextDocument, deps) {
        const documentText = document.getText()

        const UUIDs: Array<string> = Object.values(deps)
        const UUIDLength = 36
        return UUIDs.map(UUID => {
            const startPosition = documentText.indexOf(UUID)
            const lastPosition = startPosition + UUIDLength

            return new vscode.Range(
                document.positionAt(startPosition),
                document.positionAt(lastPosition)
            )
        })
    }
}
