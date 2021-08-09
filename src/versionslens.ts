import * as toml from '@iarna/toml'
import * as vscode from 'vscode'
import { registerCommand } from './utils'



export function activate(context: vscode.ExtensionContext) {
    VersionLens.register(context)
}

namespace VersionLens {
    const UUID_LENGTH = 36
    const updateDependencyCommand = 'language-julia.updateDependency'

    type uuid = string
    type TomlDependencies = { [packageName: string]: uuid }
    type ProjectToml = {
        authors?: string[];
        compat?: TomlDependencies;
        deps?: TomlDependencies;
        extras?: TomlDependencies;
        name: string;
        targets?: object;
        uuid?: uuid;
        version?: string;
    }

    export function register(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.languages.registerCodeLensProvider(
            { pattern: '**/Project.toml', language: 'toml' },
            { provideCodeLenses: provideCodeLenses },
        ))

        context.subscriptions.push(registerCommand(updateDependencyCommand, onClick))
    }

    function provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken) {
        const deps = parseProjectTomlDocument(document)
        const ranges = getPositions(document, deps)
        return ranges.map(range =>
            new vscode.CodeLens(range, { title: 'It works', command: updateDependencyCommand, tooltip: 'It works' , arguments: [deps]})
        )
    }

    function onClick(deps: TomlDependencies) {
        console.log({ deps })
    }

    function parseProjectTomlDocument(document: vscode.TextDocument) {
        const documentText = document.getText()
        const { deps } = toml.parse(documentText) as ProjectToml
        return deps
    }

    function getPositions(document: vscode.TextDocument, deps: TomlDependencies) {
        const documentText = document.getText()

        const UUIDs = Object.values(deps)
        return UUIDs.map(UUID => {
            const startPosition = documentText.indexOf(UUID)
            const lastPosition = startPosition + UUID_LENGTH

            return new vscode.Range(
                document.positionAt(startPosition),
                document.positionAt(lastPosition)
            )
        })
    }
}
