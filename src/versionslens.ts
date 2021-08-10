import * as toml from '@iarna/toml'
import * as vscode from 'vscode'
import { registerCommand } from './utils'



export function activate(context: vscode.ExtensionContext) {
    VersionLens.register(context)
    VersionDiagnostics.register()
}

namespace VersionLens {
    const UUID_LENGTH = 36
    const updateDependencyCommand = 'language-julia.updateDependency'
    const tooltip = new vscode.MarkdownString('`It works`')

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

    /**
     * Register codelens, {@link updateDependencyCommand}, and hoverProvider for Project.toml versions.
     */
    export function register(context: vscode.ExtensionContext) {
        const projectTomlSelector = {pattern: '**/Project.toml', language: 'toml'}
        context.subscriptions.push(vscode.languages.registerCodeLensProvider(
            projectTomlSelector,
            { provideCodeLenses },
        ))
        context.subscriptions.push(registerCommand(updateDependencyCommand, updateDependency))

        context.subscriptions.push(vscode.languages.registerHoverProvider(
            projectTomlSelector,
            { provideHover }
        ))
    }

    /**
     * See {@link vscode.CodeLensProvider}.
     */
    function provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken) {
        const deps = getProjectTomlDeps(document)
        const ranges = getDepsPositions(document, deps)
        return ranges.map(range =>
            new vscode.CodeLens(range, { title: 'It works', command: updateDependencyCommand, tooltip: 'It works' , arguments: [deps]})
        )
    }

    /**
     * See {@link vscode.HoverProvider}.
     */
    function provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
        const deps = getProjectTomlDeps(document)
        const ranges = getDepsPositions(document, deps)

        for (const range of ranges) {
            if (range.contains(position)) {
                const line = document.lineAt(position.line)
                return new vscode.Hover(
                    tooltip,
                    new vscode.Range(line.range.start, line.range.end))
            }
        }
    }


    function updateDependency(deps: TomlDependencies) {
        console.log({ deps })
    }

    export function getProjectTomlDeps(document: vscode.TextDocument) {
        const documentText = document.getText()
        const { deps } = toml.parse(documentText) as ProjectToml
        return deps
    }

    function getDepsPositions(document: vscode.TextDocument, deps: TomlDependencies) {
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

namespace VersionDiagnostics {
    let Diagnostics: vscode.DiagnosticCollection

    export function register() {
        Diagnostics = vscode.languages.createDiagnosticCollection('versions')
        init()
    }

    async function init() {
        const files = await findProjectTomlFiles()
        files.forEach(f =>
            Diagnostics.set(
                vscode.Uri.file(f.fsPath),
                [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 12), 'unjustified error')]
            )
        )
    }

    function findProjectTomlFiles() {
        return vscode.workspace.findFiles('**/Project.toml')
    }
}
