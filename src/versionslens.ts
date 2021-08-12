import * as toml from '@iarna/toml'
import * as vscode from 'vscode'
import { registerCommand } from './utils'



export function activate(context: vscode.ExtensionContext) {
    VersionLens.register(context)
}

namespace VersionLens {
    const UUID_LENGTH = 36
    const updateDependencyCommand = 'language-julia.updateDependency'
    const tooltip = new vscode.MarkdownString('`It works`')
    const nameTooltip = new vscode.MarkdownString('`Name works`')

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
        const name = getProjectTomlName(document)
        const depsRanges = getDepsPositions(document, deps)
        const nameRange = getNamePosition(document, name)

        if (nameRange.contains(position)) {
            return new vscode.Hover(
                nameTooltip,
                nameRange
            )
        }

        for (const range of depsRanges) {
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

    function getProjectTomlName(document: vscode.TextDocument) {
        console.log('getProjectName')
        const documentText = document.getText()
        const { name } = toml.parse(documentText) as ProjectToml

        console.log(name)
        return name
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

    function getNamePosition(document: vscode.TextDocument, name: string) {
        const documentText = document.getText()
        const nameLineRegex = RegExp(`name = ("|')${name}("|')`)
        const namePosition = documentText.match(nameLineRegex)
        const nameLength = namePosition[0]?.length

        return new vscode.Range(
            document.positionAt(namePosition?.index),
            document.positionAt(namePosition?.index + nameLength)
        )
    }
}
