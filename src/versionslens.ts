import * as toml from '@iarna/toml'
import * as vscode from 'vscode'
import { registerCommand } from './utils'



export function activate(context: vscode.ExtensionContext) {
    VersionLens.register(context)
}

namespace VersionLens {
    const updateDependencyCommand = 'language-julia.updateDependency'
    const depsTooltip = new vscode.MarkdownString('`dep works`')
    const extrasTooltip = new vscode.MarkdownString('`extra works`')
    const compatTooltip = new vscode.MarkdownString('`compat works`')
    const nameTooltip = new vscode.MarkdownString('`name works`')
    const uuidTooltip = new vscode.MarkdownString('`uuid works`')
    const versionTooltip = new vscode.MarkdownString('`version works`')
    const sectionTooltip = new vscode.MarkdownString('`section works`')

    type uuid = string
    type TomlDependencies = { [packageName: string]: uuid }
    type ProjectTomlSection = 'deps' | 'extras' | 'compat' | 'targets'
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
        const ranges = getSectionFieldsRanges(document, deps, 'deps')
        return ranges.map(range =>
            new vscode.CodeLens(range, { title: 'update', command: updateDependencyCommand, arguments: [deps]})
        )
    }

    /**
     * See {@link vscode.HoverProvider}.
     */
    function provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
        const { deps, name, uuid, version, extras, compat } = getProjectTomlFields(document)

        if (uuid) {
            const uuidRange = getUuidRange(document, uuid)
            if (uuidRange.contains(position)) {
                return new vscode.Hover(
                    uuidTooltip,
                    uuidRange
                )
            }
        }

        if (name) {
            const nameRange = getNameRange(document, name)
            if (nameRange.contains(position)) {
                return new vscode.Hover(
                    nameTooltip,
                    nameRange
                )
            }
        }

        if (version) {
            const versionRage = getVersionRange(document, version)
            if (versionRage.contains(position)) {
                return new vscode.Hover(
                    versionTooltip,
                    versionRage
                )
            }

        }

        if (deps) {
            const depsRanges = getSectionFieldsRanges(document, deps, 'deps')
            for (const range of depsRanges) {
                if (range.contains(position)) {
                    return new vscode.Hover(
                        depsTooltip,
                        range
                    )
                }
            }
        }

        if (extras) {
            const extrasRanges = getSectionFieldsRanges(document, extras, 'extras')
            for (const range of extrasRanges) {
                if (range.contains(position)) {
                    return new vscode.Hover(
                        extrasTooltip,
                        range
                    )
                }
            }
        }

        if (compat) {
            const compatRanges = getSectionFieldsRanges(document, compat, 'compat')
            for (const range of compatRanges) {
                if (range.contains(position)) {
                    return new vscode.Hover(
                        compatTooltip,
                        range
                    )
                }
            }
        }

        const sectionsRanges = getSectionsHeadersRanges(document)
        for (const range of sectionsRanges) {
            if (range.contains(position)) {
                return new vscode.Hover(
                    sectionTooltip,
                    range
                )
            }
        }
    }

    function updateDependency(deps: TomlDependencies) {
        console.log({ deps })
    }

    function getProjectTomlFields(document: vscode.TextDocument) {
        const documentText = document.getText()
        return toml.parse(documentText) as ProjectToml
    }

    function getSectionsHeadersRanges(document: vscode.TextDocument) {
        const sectionsNames: Array<ProjectTomlSection> = ['deps', 'compat', 'extras', 'targets']
        const documentText = document.getText()

        return sectionsNames
            .map(sectionName => {
                const sectionRegExp = RegExp(`\\[${sectionName}\\]`)
                const matchedSection = documentText.match(sectionRegExp)
                const sectionLength = matchedSection?.index ? matchedSection[0].length : 0

                if (sectionLength !== 0) {
                    return new vscode.Range(
                        document.positionAt(matchedSection.index),
                        document.positionAt(matchedSection.index + sectionLength)
                    )
                }
            })
            .filter(name => name !== undefined)
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

    function getSectionFieldsRanges(document: vscode.TextDocument, fields: TomlDependencies, section: ProjectTomlSection) {
        const documentText = document.getText()

        const sectionFieldsRegExp = RegExp(`\\[${section}\\]((\r\n|\r|\n)|.)*(\r\n|\r|\n)(\\[|(\r\n|\r|\n))`)
        const matchedSectionField = documentText.match(sectionFieldsRegExp)
        const sectionFieldStart = matchedSectionField?.index
        const sectionFieldText = matchedSectionField[0]

        const depsNames = Object.keys(fields)
        return depsNames.map(depName => {
            const fieldRegexp = RegExp(`${depName}[ ]*=[ ]*("|')${fields[depName]}("|')`)
            const fieldPosition = sectionFieldText.match(fieldRegexp)
            const fieldLength = fieldPosition[0]?.length

            return new vscode.Range(
                document.positionAt(fieldPosition?.index + sectionFieldStart),
                document.positionAt(fieldPosition?.index  + fieldLength + sectionFieldStart)
            )
        })
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
