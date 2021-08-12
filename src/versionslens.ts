import * as toml from '@iarna/toml'
import * as vscode from 'vscode'
import { registerCommand } from './utils'



export function activate(context: vscode.ExtensionContext) {
    VersionLens.register(context)
}

namespace VersionLens {
    const updateDependencyCommand = 'language-julia.updateDependency'
    const tooltip = new vscode.MarkdownString('`It works`')
    const nameTooltip = new vscode.MarkdownString('`Name works`')
    const uuidTooltip = new vscode.MarkdownString('`uuid works`')
    const versionTooltip = new vscode.MarkdownString('`version works`')

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
        const { deps } = getProjectTomlFields(document)
        const ranges = getDepsRange(document, deps)
        return ranges.map(range =>
            new vscode.CodeLens(range, { title: 'It works', command: updateDependencyCommand, tooltip: 'It works' , arguments: [deps]})
        )
    }

    /**
     * See {@link vscode.HoverProvider}.
     */
    function provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
        const { deps, name, uuid, version, extras } = getProjectTomlFields(document)

        const depsRanges = getDepsRange(document, deps)
        const extrasRanges = getDepsRange(document, extras)
        const nameRange = getNameRange(document, name)
        const uuidRange = getUuidRange(document, uuid)
        const versionRage = getVersionRange(document, version)

        if (uuidRange.contains(position)) {
            return new vscode.Hover(
                uuidTooltip,
                uuidRange
            )
        }

        if (versionRage.contains(position)) {
            return new vscode.Hover(
                versionTooltip,
                versionRage
            )
        }


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

        for (const range of extrasRanges) {
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

    export function getProjectTomlFields(document: vscode.TextDocument) {
        const documentText = document.getText()
        return toml.parse(documentText) as ProjectToml
    }

    function getDepsRange(document: vscode.TextDocument, deps: TomlDependencies) {

        const documentText = document.getText()
        const depsNames = Object.keys(deps)

        return depsNames.map(depName => {
            const depRegexp = RegExp(`${depName}[ ]*=[ ]*("|')${deps[depName]}("|')`)
            const depPosition = documentText.match(depRegexp)
            const depLength = depPosition[0]?.length

            return new vscode.Range(
                document.positionAt(depPosition?.index),
                document.positionAt(depPosition?.index  + depLength)
            )
        })
    }

    function getNameRange(document: vscode.TextDocument, name: string) {
        const documentText = document.getText()
        const nameLineRegexp = RegExp(`name[ ]*=[ ]*("|')${name}("|')`)
        const namePosition = documentText.match(nameLineRegexp)
        const nameLength = namePosition[0]?.length

        return new vscode.Range(
            document.positionAt(namePosition?.index),
            document.positionAt(namePosition?.index + nameLength)
        )
    }

    function getUuidRange(document: vscode.TextDocument, uuid: string) {
        const documentText = document.getText()
        const uuidLineRegexp = RegExp(`uuid[ ]*=[ ]*("|')${uuid}("|')`)
        const uuidPosition = documentText.match(uuidLineRegexp)
        const uuidLength = uuidPosition[0]?.length

        return new vscode.Range(
            document.positionAt(uuidPosition?.index),
            document.positionAt(uuidPosition?.index + uuidLength)
        )
    }


    function getVersionRange(document: vscode.TextDocument, version: string) {
        const documentText = document.getText()
        const versionLineRegexp = RegExp(`version[ ]*=[ ]*("|')${version}("|')`)
        const versionPosition = documentText.match(versionLineRegexp)
        const versionLength = versionPosition[0]?.length


        return new vscode.Range(
            document.positionAt(versionPosition?.index),
            document.positionAt(versionPosition?.index + versionLength)
        )
    }
}
