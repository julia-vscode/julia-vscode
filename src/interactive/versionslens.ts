import * as toml from '@iarna/toml'
import * as cp from 'child-process-promise'
import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc'
import { registerCommand } from '../utils'
import { g_connection as g_repl_connection, startREPL } from './repl'

export function activate(context: vscode.ExtensionContext) {
    VersionLens.register(context)
}

type uuid = string
type TomlDependency = { [packageName: string]: uuid }
type ProjectTomlSection = 'deps' | 'extras' | 'compat' | 'targets'
type ProjectTomlKey = 'name' | 'version' | 'uuid'
type ProjectToml = {
    authors?: string[];
    compat?: TomlDependency;
    deps?: TomlDependency;
    extras?: TomlDependency;
    name: string;
    targets?: object;
    uuid?: uuid;
    version?: string;
}

enum UpgradeLevel {
    major = 'UPLEVEL_MAJOR',
    minor = 'UPLEVEL_MINOR',
    patch = 'UPLEVEL_PATCH',
    fixed = 'UPLEVEL_FIXED'
}

namespace VersionLens {
    const projectTomlSelector = { pattern: '**/Project.toml', language: 'toml' }

    const requestTypeLens = new rpc.RequestType<{ name: string, uuid: string }, {
        latest_version: string, url: string, registry: string
    }, void>('lens/pkgVersions')

    const updateAllDependenciesCommand = 'language-julia.updateAllDependencies'
    const queryRegistriesCommand = 'language-julia.versionsLensQueryRegistries'

    let g_juliaVersionLensRegistriesReady = false
    let g_juliaVersionLensRegistriesLoading = false
    let g_isUpdatingPackagesLock = false

    /**
     * Register codelens, {@link updateAllDependenciesCommand}, {@link queryRegistriesCommand},
     *  {@link registerSectionsFieldsHovers}, and {@link registerGeneralHovers} for Project.toml.
     */
    export function register(context: vscode.ExtensionContext) {
        registerGeneralHovers(context)
        registerSectionsFieldsHovers(context)

        context.subscriptions.push(vscode.languages.registerCodeLensProvider(
            projectTomlSelector,
            { provideCodeLenses },
        ))

        context.subscriptions.push(registerCommand(updateAllDependenciesCommand, updateAllDependencies))
        context.subscriptions.push(registerCommand(queryRegistriesCommand, queryRegistries))
    }

    /**
     * Register hover provider for the fields inside different {@link ProjectTomlSection} sections, e.g.,
     * ```toml
     * [deps]
     * SHA = "ea8e919c-243c-51af-8825-aaa63cd721ce" # <- registered for this
     * ```
     */
    function registerSectionsFieldsHovers(context: vscode.ExtensionContext) {
        /*
         * - The hover provides had to be split into multiple ones; hovering over
         *   the fields in the [deps] section will always return, then the other
         *   hover are unreachable.
         * - The [deps] fields will always return if the registries aren't
         *   initialized, i.e., the user hasn't clicked the versions icon.
         * - The hover now are (aware) of the status of the registry query, the
         *   registry query can be one of (hasn't been queried yet|loading|return
         *   the package info).
         */
        context.subscriptions.push(vscode.languages.registerHoverProvider(
            projectTomlSelector,
            { provideHover: provideDepsFieldsHover }
        ))
        context.subscriptions.push(vscode.languages.registerHoverProvider(
            projectTomlSelector,
            { provideHover: provideCompatFieldsHover }
        ))
        context.subscriptions.push(vscode.languages.registerHoverProvider(
            projectTomlSelector,
            { provideHover: provideExtrasFieldsHover }
        ))
    }

    /**
     * Register hover provider for {@link ProjectTomlKey}, and {@link ProjectTomlSection} headers.
     * ```toml
     * name = "Tar"  # <- registered for this
     * uuid = "a4e569a6-e804-4fa4-b0f3-eef7a1d5b13e"  # <- registered for this
     * version = "1.10.0"  # <- registered for this

     * [deps]  # <- registered for this
     * ArgTools = "0dad84c5-d112-42e6-8d28-ef12dabb789f"
     * SHA = "ea8e919c-243c-51af-8825-aaa63cd721ce"
     * ```
     */
    function registerGeneralHovers(context: vscode.ExtensionContext) {
        context.subscriptions.push(vscode.languages.registerHoverProvider(
            projectTomlSelector,
            { provideHover: provideFieldsAndHeadersHover }
        ))
    }

    /**
     * See {@link vscode.CodeLensProvider}.
     */
    function provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken) {
        const [_, depsHeaderRange] = getSectionsHeadersRanges(document)
            .filter(([sectionName, _]) => sectionName === 'deps')[0]

        return [
            new vscode.CodeLens(
                depsHeaderRange,
                { title: 'Update all packages (Major)', command: updateAllDependenciesCommand, arguments: [UpgradeLevel.major] }
            ),
            new vscode.CodeLens(
                depsHeaderRange,
                { title: 'Update all packages (Minor)', command: updateAllDependenciesCommand, arguments: [UpgradeLevel.minor] }
            ),
            new vscode.CodeLens(
                depsHeaderRange,
                { title: 'Update all packages (Patch)', command: updateAllDependenciesCommand, arguments: [UpgradeLevel.patch] }
            ),
            new vscode.CodeLens(
                depsHeaderRange,
                { title: 'Update all packages (Fixed)', command: updateAllDependenciesCommand, arguments: [UpgradeLevel.fixed] }
            )
        ]
    }

    /**
     * See {@link vscode.HoverProvider}.
     */
    function provideFieldsAndHeadersHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
        const { name, uuid, version } = getProjectTomlFields(document)

        if (uuid) {
            const uuidRange = getFieldRange(document, 'uuid', uuid)
            const hover = fieldHover('uuid', uuidRange, position)
            if (hover) { return hover }
        }

        if (name) {
            const nameRange = getFieldRange(document, 'name', name)
            const hover = fieldHover('name', nameRange, position)
            if (hover) { return hover }
        }

        if (version) {
            const versionRange = getFieldRange(document, 'version', version)
            const hover = fieldHover('version', versionRange, position)
            if (hover) { return hover }
        }

        const sectionsHeadersRanges = getSectionsHeadersRanges(document)
        for (const [sectionName, range] of sectionsHeadersRanges) {
            if (range.contains(position)) {
                return new vscode.Hover(
                    Tooltips.sectionsHeaders[sectionName],
                    range
                )
            }
        }
    }

    function provideDepsFieldsHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
        const { deps } = getProjectTomlFields(document)

        if (deps) {
            const depsRanges = getSectionFieldsRanges(document, 'deps', deps)
            return sectionHover('deps', depsRanges, position)
        }
    }


    function provideExtrasFieldsHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
        const {  extras } = getProjectTomlFields(document)

        if (extras) {
            const extrasRanges = getSectionFieldsRanges(document, 'extras', extras)
            return sectionHover('extras', extrasRanges, position)
        }
    }

    function provideCompatFieldsHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
        const { compat } = getProjectTomlFields(document)

        if (compat) {
            const compatRanges = getSectionFieldsRanges(document, 'compat', compat)
            return sectionHover('compat', compatRanges, position)
        }
    }

    async function updateAllDependencies(level: UpgradeLevel) {
        if (g_isUpdatingPackagesLock) {
            // If there's an update operation running, show warning and ignore the request.
            vscode.window.showWarningMessage('Another operation is running, wait until it finishes.')
            return
        }

        // Acquire the updating status lock
        g_isUpdatingPackagesLock = true
        const projectRoot = vscode.workspace.workspaceFolders[0]
        const updateCommand = `julia --project=. -e "using Pkg; Pkg.update(;level=Pkg.${level})"`

        vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Updating packages' }, async (progress) => {
            // The output for this command somehow is piped into stderr not stdout
            // We can't use stderr to detect failures.
            const { stderr } = await cp.exec(updateCommand, { cwd: projectRoot.uri.fsPath })
            // This line will only get executed if the execution is done, so remove the progress notification
            progress.report({ increment: 100 })
            // Show the result of the operation.
            // We can't say whether the operation succeeded or not because the output is piped into stderr in both cases.
            vscode.window.showInformationMessage(`Pkg finished operation.\n${stderr}`)
            // Release the updating status lock
            g_isUpdatingPackagesLock = false
        })
    }

    async function queryRegistries() {
        if (g_repl_connection === undefined) {
            g_juliaVersionLensRegistriesLoading = true
            await startREPL(false)
            g_juliaVersionLensRegistriesLoading = false
        }

        g_juliaVersionLensRegistriesReady = true
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
                const sectionLength = matchedSection?.length ? matchedSection[0].length : 0

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

    function getSectionFieldsRanges(document: vscode.TextDocument, section: ProjectTomlSection, fields: TomlDependency,) {
        /*
        * ┌──────►Match the section header, e.g., [deps].
        * │ ┌────►Match a newline or any character, zero or more times until──┐
        * │ │ ┌───────────────────────────────────────────────────────────────┘
        * │ │ │
        * │ │ └┐►Match a newline followed by the beginning of another section, i.e., `[`, or EOF.
        * │ │  └─────────────────────────────────────────────────┐
        * │ └────────────────────────┐                           │
        * │        ┌────────────────┬┴─────────────────────────┬─┴───────────────────────────────────────────┐
        * └────────┤\\[${section}\\]│ (${NEWLINE_DELIMITER}|.)*│${NEWLINE_DELIMITER}(\\[|${NEwLINE_DELIMITER}│
        *          └────────────────┴──────────────────────────┴─────────────────────────────────────────────┘
        */
        const NEWLINE_DELIMITER = '(\r\n|\r|\n)'
        const sectionFieldsRegExp = RegExp(
            `\\[${section}\\](${NEWLINE_DELIMITER}|.)*${NEWLINE_DELIMITER}(\\[|${NEWLINE_DELIMITER})`
        )

        const documentText = document.getText()
        const matchedSectionField = documentText.match(sectionFieldsRegExp)
        const sectionFieldStart = matchedSectionField?.index
        const sectionFieldText = matchedSectionField[0]

        const depsNames = Object.keys(fields)
        return depsNames.map(depName => {
            const fieldRegexp = RegExp(`${depName}[ ]*=[ ]*("|')${fields[depName]}("|')`)
            const fieldPosition = sectionFieldText.match(fieldRegexp)
            const fieldLength = fieldPosition[0]?.length

            return [
                { [depName]: fields[depName] },
                new vscode.Range(
                    document.positionAt(fieldPosition?.index + sectionFieldStart),
                    document.positionAt(fieldPosition?.index  + fieldLength + sectionFieldStart)
                )
            ] as [TomlDependency, vscode.Range]
        })
    }

    function getFieldRange(document: vscode.TextDocument, key: ProjectTomlKey, value: string) {
        const documentText = document.getText()
        const fieldRegExp = RegExp(`${key}[ ]*=[ ]*("|')${value}("|')`)
        const matchedField = documentText.match(fieldRegExp)
        const fieldLength = matchedField?.length ? matchedField[0]?.length : 0

        if (fieldLength !== 0) {
            return new vscode.Range(
                document.positionAt(matchedField.index),
                document.positionAt(matchedField.index + fieldLength)
            )
        } else {
            // Return empty range
            return new vscode.Range(document.positionAt(-1), document.positionAt(-1))
        }
    }

    function fieldHover(key: ProjectTomlKey, range: vscode.Range, position: vscode.Position) {
        if (range.contains(position)) {
            return new vscode.Hover(
                Tooltips[key],
                range
            )
        }
    }

    async function sectionHover(key: ProjectTomlSection, depsRanges: [TomlDependency, vscode.Range][], position: vscode.Position) {
        if (!(g_juliaVersionLensRegistriesLoading || g_juliaVersionLensRegistriesReady)) {
            for (const [_, range] of depsRanges) {
                if (range.contains(position)) {
                    return new vscode.Hover(Tooltips.queryRegistriesHint, range)
                }
            }
        }

        if (g_juliaVersionLensRegistriesLoading) {
            for (const [_, range] of depsRanges) {
                if (range.contains(position)) {
                    return new vscode.Hover('Getting packages data...', range)
                }
            }
        }

        if (g_juliaVersionLensRegistriesReady) {
            for (const [dependency, range] of depsRanges) {
                if (range.contains(position)) {
                    const depName = Object.keys(dependency)[0]
                    const { latest_version, url, registry } = await g_repl_connection.sendRequest(
                        requestTypeLens, { name: depName, uuid: dependency[depName] }
                    )

                    return new vscode.Hover(
                        Tooltips.DependencyHover(depName, latest_version, url, registry),
                        range
                    )
                }
            }
        }
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
    A string with a [universally unique identifier](https://en.wikipedia.org/wiki/Universally_unique_identifier) for the package/project.
    \nThe \`uuid\` field is mandatory for packages. See [Pkg docs](http://pkgdocs.julialang.org/v1/toml-files/#The-uuid-field).
    `)
    export const version = new vscode.MarkdownString(dedent`
    A string with the version number for the package/project.
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
    export const queryRegistriesHint = new vscode.MarkdownString(
        'To get packages information, click on the `$(versions)` icon in the editor title bar.',
        true
    )

    /**
     * @constructor
     */
    export function DependencyHover(name: string, latestVersion: string, url: string, registry: string) {
        if (latestVersion === null) {
            return new vscode.MarkdownString(dedent`
            - \`${registry}\` module.
            - See [Standard Library docs](https://juliafs.readthedocs.io/en/stable/stdlib/index.html).
            `)
        }

        return new vscode.MarkdownString(dedent`
        - ${name} in the \`${registry}\` registry.
        - The latest version is \`${latestVersion}\`.
        - More on [the package Homepage](${url}).
        `)
    }

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
