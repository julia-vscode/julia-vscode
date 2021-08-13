import * as toml from '@iarna/toml'
import * as vscode from 'vscode'
import { registerCommand } from './utils'



export function activate(context: vscode.ExtensionContext) {
    VersionLens.register(context)
}

namespace VersionLens {
    const updateDependencyCommand = 'language-julia.updateDependency'

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
                    Tooltips.uuid,
                    uuidRange
                )
            }
        }

        if (name) {
            const nameRange = getNameRange(document, name)
            if (nameRange.contains(position)) {
                return new vscode.Hover(
                    Tooltips.name,
                    nameRange
                )
            }
        }

        if (version) {
            const versionRage = getVersionRange(document, version)
            if (versionRage.contains(position)) {
                return new vscode.Hover(
                    Tooltips.version,
                    versionRage
                )
            }

        }

        if (deps) {
            const depsRanges = getSectionFieldsRanges(document, deps, 'deps')
            for (const range of depsRanges) {
                if (range.contains(position)) {
                    return new vscode.Hover(
                        Tooltips.deps,
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
                        Tooltips.extras,
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
                        Tooltips.compat,
                        range
                    )
                }
            }
        }

        const sectionsRanges = getSectionsHeadersRanges(document)
        for (const [sectionName, range] of sectionsRanges) {
            if (range.contains(position)) {
                return new vscode.Hover(
                    Tooltips.sectionsHeaders[sectionName],
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
                    return [
                        sectionName,
                        new vscode.Range(
                            document.positionAt(matchedSection.index),
                            document.positionAt(matchedSection.index + sectionLength)
                        )
                    ] as [ProjectTomlSection, vscode.Range]
                }
            })
            .filter(range => range !== undefined)
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

namespace Tooltips {
    export const name = new vscode.MarkdownString(dedent`
    The name of the package/project.
    The \`name\` can contain word characters \`[a-zA-Z0-9_]\`, but can not start with a number.
    For packages it is recommended to follow [the package naming guidelines](http://pkgdocs.julialang.org/v1/creating-packages/#Package-naming-guidelines).
    \nThe \`name\` field is mandatory for packages. See [Pkg docs](http://pkgdocs.julialang.org/v1/toml-files/#The-name-field).
    `)
    export const uuid = new vscode.MarkdownString(dedent`
    \`uuid\` is a string with a [universally unique identifier](https://en.wikipedia.org/wiki/Universally_unique_identifier) for the package/project.
    \nThe \`uuid\` field is mandatory for packages. See [Pkg docs](http://pkgdocs.julialang.org/v1/toml-files/#The-uuid-field).
    `)
    export const version = new vscode.MarkdownString(dedent`
    \`version\` is a string with the version number for the package/project.
    Julia uses [Semantic Versioning (SemVer)](https://semver.org/).
    See [Pkg docs](http://pkgdocs.julialang.org/v1/toml-files/#The-version-field).
    \n**Note that Pkg.jl deviates from the SemVer specification when it comes to versions pre-1.0.0.
    See the section on [pre-1.0 behavior](http://pkgdocs.julialang.org/v1/compatibility/#compat-pre-1.0) for more details.**
    `)
    export const sectionsHeaders = {
        deps: new vscode.MarkdownString(dedent`
        All dependencies of the package/project.
        Each dependency is listed as a name-uuid pair.
        Typically it is not needed to manually add entries to the \`[deps]\` section; this is instead handled by \`Pkg\` operations such as \`add\`.
        See [Pkg docs](http://pkgdocs.julialang.org/v1/toml-files/#The-[deps]-section).
        `),
        compat: new vscode.MarkdownString(dedent`
        Compatibility constraints for the dependencies listed under \`[deps]\`.
        See [Pkg docs](http://pkgdocs.julialang.org/v1/compatibility/#Compatibility).
        `),
        extras: new vscode.MarkdownString(dedent`
        Test-specific dependencies in Julia \`1.0\` and \`1.1\`.
        See [Pkg docs](http://pkgdocs.julialang.org/v1/creating-packages/#Test-specific-dependencies-in-Julia-1.0-and-1.1).
        `),
        targets: new vscode.MarkdownString(dedent`
        Test-specific dependencies in Julia \`1.0\` and \`1.1\`.
        See [Pkg docs](http://pkgdocs.julialang.org/v1/creating-packages/#Test-specific-dependencies-in-Julia-1.0-and-1.1).
        `)
    }
    export const deps = new vscode.MarkdownString('`dep works`')
    export const extras = new vscode.MarkdownString('`extra works`')
    export const compat = new vscode.MarkdownString('`compat works`')

    function dedent(callSite, ...args) {
        function format(str) {
            let size = -1

            return str.replace(/\n(\s+)/g, (m, m1) => {

                if (size < 0)
                {size = m1.replace(/\t/g, '    ').length}

                return '\n' + m1.slice(Math.min(m1.length, size))
            })
        }

        if (typeof callSite === 'string') {
            return format(callSite)
        }

        if (typeof callSite === 'function') {
            return (...args) => format(callSite(...args))
        }

        const output = callSite
            .slice(0, args.length + 1)
            .map((text, i) => (i === 0 ? '' : args[i - 1]) + text)
            .join('')

        return format(output)
    }
}
