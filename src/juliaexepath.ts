import { exists } from 'async-file'
import * as os from 'os'
import * as path from 'path'
import * as process from 'process'
import { execFile } from 'promisify-child-process'
import { parse } from 'semver'
import stringArgv from 'string-argv'
import * as vscode from 'vscode'
import { JuliaGlobalDiagnosticOutputFeature } from './globalDiagnosticOutput'
import { setCurrentJuliaVersion, traceEvent } from './telemetry'
import { resolvePath } from './utils'

export interface JuliaupChannelInfo {
    Name: string
    File: string
    Args: string[]
    Version: string
    Arch: string
}
export interface JuliaupApiGetinfoReturn {
    DefaultChannel?: JuliaupChannelInfo
    OtherChannels: JuliaupChannelInfo[]
}

export class JuliaExecutable {
    private _baseRootFolderPath: string | undefined

    constructor(
        public version: string,
        public file: string,
        public args: string[],
        public arch: string | undefined,
        public channel: string | undefined,
        public officialChannel: boolean
    ) {}

    public getVersion() {
        return parse(this.version)
    }

    public async getBaseRootFolderPathAsync() {
        if (!this._baseRootFolderPath) {
            const result = await execFile(
                this.file,
                [...this.args, '--startup-file=no', '--history-file=no', '-e', 'println(Sys.BINDIR)'],
                {
                    env: {
                        ...process.env,
                        JULIA_VSCODE_INTERNAL: '1',
                    },
                }
            )

            this._baseRootFolderPath = path.normalize(
                path.join(result.stdout.toString().trim(), '..', 'share', 'julia', 'base')
            )
        }

        return this._baseRootFolderPath
    }

    public getCommand(...args: string[]) {
        // TODO Properly escape things
        return [this.file, ...this.args, ...args].join(' ')
    }
}

export class JuliaupExecutable {
    constructor(
        public version: string,
        public file: string
    ) {}

    public getVersion() {
        return parse(this.version)
    }
}

export class JuliaExecutablesFeature {
    private actualJuliaExePath: JuliaExecutable | undefined
    private actualJuliaupExePath: JuliaupExecutable | undefined
    private actualLanguageServerJuliaExePath: JuliaExecutable | undefined
    private cachedJuliaExePaths: JuliaExecutable[] | undefined
    private usingJuliaup: boolean | null = null

    constructor(
        private context: vscode.ExtensionContext,
        private diagnosticsOutput: JuliaGlobalDiagnosticOutputFeature
    ) {
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
                if (
                    event.affectsConfiguration('julia.executablePath') ||
                    event.affectsConfiguration('julia.languageServerExecutablePath')
                ) {
                    this.actualJuliaExePath = undefined
                    this.actualLanguageServerJuliaExePath = undefined
                    this.cachedJuliaExePaths = undefined
                    this.usingJuliaup = null
                }
            })
        )
    }

    public dispose() {}

    async tryJuliaExePathAsync(newPath: string) {
        try {
            let parsedPath = ''
            let parsedArgs = []

            if (path.isAbsolute(newPath) && (await exists(newPath))) {
                parsedPath = newPath
            } else {
                const resolvedPath = resolvePath(newPath, false)

                if (path.isAbsolute(resolvedPath) && (await exists(resolvedPath))) {
                    parsedPath = resolvedPath
                } else {
                    const argv = stringArgv(newPath)

                    parsedPath = argv[0]
                    parsedArgs = argv.slice(1)
                }
            }
            const { stdout } = await execFile(parsedPath, [...parsedArgs, '--version'], {
                env: {
                    ...process.env,
                    JULIA_VSCODE_INTERNAL: '1',
                },
            })

            const versionStringFromJulia = stdout.toString().trim()

            const versionPrefix = `julia version `
            if (!versionStringFromJulia.startsWith(versionPrefix)) {
                return undefined
            }

            return new JuliaExecutable(
                versionStringFromJulia.slice(versionPrefix.length),
                parsedPath,
                parsedArgs,
                undefined,
                undefined,
                true
            )
        } catch {
            return undefined
        }
    }

    async tryAndSetNewJuliaExePathAsync(newPath: string) {
        const newJuliaExecutable = await this.tryJuliaExePathAsync(newPath)

        if (newJuliaExecutable) {
            this.actualJuliaExePath = newJuliaExecutable
            setCurrentJuliaVersion(this.actualJuliaExePath.version)
            traceEvent('configured-new-julia-binary')

            return true
        } else {
            return false
        }
    }

    async tryAndSetNewLanguageServerJuliaExePathAsync(newPath: string) {
        const newJuliaExecutable = await this.tryJuliaExePathAsync(newPath)

        if (newJuliaExecutable) {
            this.actualLanguageServerJuliaExePath = newJuliaExecutable
            traceEvent('configured-new-ls-julia-binary')

            return true
        } else {
            return false
        }
    }

    getSearchPaths(): string[] {
        const homedir = os.homedir()
        let pathsToSearch = []
        if (process.platform === 'win32') {
            pathsToSearch = [
                'julia.exe',
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.11.2', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.11.1', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.11.0', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.10.5', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.10.4', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.10.3', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.10.2', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.10.1', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.10.0', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.9.4', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.9.3', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.9.2', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.9.1', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.9.0', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.8.5', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.8.4', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.8.3', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.8.2', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.8.1', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.8.0', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.7.3', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.7.2', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.7.1', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.7.0', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.6.8', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.6.7', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.6.6', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.6.5', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.6.4', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.6.3', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.6.2', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.6.1', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.6.0', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia 1.5.4', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia 1.5.3', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia 1.5.2', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia 1.5.1', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia 1.5.0', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia', 'Julia-1.4.2', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia', 'Julia-1.4.1', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia', 'Julia-1.4.0', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.3.1', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.3.0', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.2.0', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.1.1', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.1.0', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.0.5', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.0.4', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.0.3', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.0.2', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.0.1', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.0.0', 'bin', 'julia.exe'),
            ]
        } else if (process.platform === 'darwin') {
            pathsToSearch = [
                'julia',
                path.join(homedir, 'Applications', 'Julia-1.11.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join('/', 'Applications', 'Julia-1.11.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join(homedir, 'Applications', 'Julia-1.10.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join('/', 'Applications', 'Julia-1.10.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join(homedir, 'Applications', 'Julia-1.9.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join('/', 'Applications', 'Julia-1.9.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join(homedir, 'Applications', 'Julia-1.8.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join('/', 'Applications', 'Julia-1.8.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join(homedir, 'Applications', 'Julia-1.7.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join('/', 'Applications', 'Julia-1.7.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join(homedir, 'Applications', 'Julia-1.6.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join('/', 'Applications', 'Julia-1.6.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join(homedir, 'Applications', 'Julia-1.5.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join('/', 'Applications', 'Julia-1.5.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join(homedir, 'Applications', 'Julia-1.4.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join('/', 'Applications', 'Julia-1.4.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join(homedir, 'Applications', 'Julia-1.3.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join('/', 'Applications', 'Julia-1.3.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join(homedir, 'Applications', 'Julia-1.2.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join('/', 'Applications', 'Julia-1.2.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join(homedir, 'Applications', 'Julia-1.1.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join('/', 'Applications', 'Julia-1.1.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join(homedir, 'Applications', 'Julia-1.0.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                path.join('/', 'Applications', 'Julia-1.0.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
            ]
        } else {
            pathsToSearch = ['julia']
        }
        return pathsToSearch
    }

    public async getInstalledJuliaVersions(juliaupObj: JuliaupExecutable) {
        const { stdout } = await execFile(juliaupObj.file, ['api', 'getconfig1'], {
            shell: process.platform === 'win32' ? false : true,
        })
        const installedVersions: JuliaupApiGetinfoReturn = JSON.parse(stdout.toString().trim())

        const defaultVersion = installedVersions.DefaultChannel
        const otherVersions = installedVersions.OtherChannels

        const versions: (JuliaupChannelInfo & vscode.QuickPickItem & { default: boolean })[] = []

        if (Object.keys(defaultVersion).length) {
            versions.push({
                label: defaultVersion.Name,
                default: true,
                description: `Julia v${defaultVersion.Version} (current)`,
                ...defaultVersion,
            })
        }

        if (otherVersions.length) {
            otherVersions.forEach((ele) => {
                versions.push({
                    label: ele.Name,
                    default: false,
                    description: `Julia v${ele.Version}`,
                    ...ele,
                })
            })
        }

        return versions
    }

    async tryJuliaup() {
        this.usingJuliaup = false
        try {
            const juliaupObj = await this.getActiveJuliaupExecutableAsync()

            if (!juliaupObj) {
                return false
            }

            const versions = await this.getInstalledJuliaVersions(juliaupObj)

            if (versions.length) {
                const defaultVersion = versions.find((ele) => ele.default)
                const otherVersions = versions.filter((ele) => !ele.default)

                if (!defaultVersion) {
                    return false
                }

                this.actualJuliaExePath = new JuliaExecutable(
                    defaultVersion.Version,
                    defaultVersion.File,
                    defaultVersion.Args,
                    defaultVersion.Arch,
                    defaultVersion.Name,
                    true
                )

                this.cachedJuliaExePaths = otherVersions
                    .map((i) => new JuliaExecutable(i.Version, i.File, i.Args, i.Arch, i.Name, true))
                    .concat(this.actualJuliaExePath)

                this.usingJuliaup = true

                return true
            } else {
                return false
            }
        } catch {
            return false
        }
    }

    public async getJuliaExePathsAsync(): Promise<JuliaExecutable[]> {
        if (!this.cachedJuliaExePaths) {
            if (!(await this.tryJuliaup())) {
                const searchPaths = this.getSearchPaths()

                const executables: JuliaExecutable[] = []
                executables.push(await this.getActiveJuliaExecutableAsync())
                await Promise.all(
                    searchPaths.map(async (filePath) => {
                        const newJuliaExecutable = await this.tryJuliaExePathAsync(filePath)

                        if (newJuliaExecutable) {
                            executables.push(newJuliaExecutable)
                        }
                    })
                )

                // Remove duplicates.
                this.cachedJuliaExePaths = executables.filter(
                    (v, i, a) => a.findIndex((t) => JSON.stringify(t) === JSON.stringify(v)) === i
                )
            }
        }

        return this.cachedJuliaExePaths
    }

    public async getActiveJuliaExecutableAsync() {
        if (!this.actualJuliaExePath) {
            this.diagnosticsOutput.appendLine('Trying to locate Julia binary...')

            if (!(await this.tryJuliaup())) {
                this.diagnosticsOutput.appendLine('Juliaup not found, locating Julia by other means.')

                const configPath = this.getExecutablePath()
                this.diagnosticsOutput.appendLine(
                    `The current configuration value for 'julia.executablePath' is '${configPath}'.`
                )

                if (!configPath) {
                    for (const p of this.getSearchPaths()) {
                        if (await this.tryAndSetNewJuliaExePathAsync(p)) {
                            break
                        }
                    }
                } else {
                    await this.tryAndSetNewJuliaExePathAsync(configPath)
                }

                const LSConfigPath = this.getLanguageServerExecutablePath()
                this.diagnosticsOutput.appendLine(
                    `The current configuration value for 'julia.languageServerExecutablePath' is '${LSConfigPath}'.`
                )

                if (LSConfigPath) {
                    await this.tryAndSetNewLanguageServerJuliaExePathAsync(LSConfigPath)
                }
            }
            // Even when Juliaup reports a version, we still want the configuration setting
            // to have higher priority
            else {
                this.diagnosticsOutput.appendLine('Juliaup found.')

                const configPath = this.getExecutablePath()

                this.diagnosticsOutput.appendLine(
                    `The current configuration value for 'julia.executablePath' is '${configPath}'.`
                )

                if (configPath) {
                    await this.tryAndSetNewJuliaExePathAsync(configPath)
                }

                const LSConfigPath = this.getLanguageServerExecutablePath()
                this.diagnosticsOutput.appendLine(
                    `The current configuration value for 'julia.languageServerExecutablePath' is '${LSConfigPath}'.`
                )

                if (LSConfigPath) {
                    await this.tryAndSetNewLanguageServerJuliaExePathAsync(LSConfigPath)
                }
            }

            if (this.actualJuliaExePath) {
                this.diagnosticsOutput.appendLine(
                    `The identified Julia executable is "${this.actualJuliaExePath.file}" with args "${this.actualJuliaExePath.args}".`
                )
            } else {
                this.diagnosticsOutput.appendLine(`No Julia executable was identified.`)
            }
            this.diagnosticsOutput.appendLine(`The current PATH environment variable is "${process.env.PATH}".`)
        }
        return this.actualJuliaExePath
    }

    public async getActiveJuliaupExecutableAsync() {
        if (!this.actualJuliaupExePath) {
            this.diagnosticsOutput.appendLine('Trying to locate Juliaup binary...')

            try {
                // Finding paths is too complicated for windows
                // so we just return 'juliaup' alias
                const { stdout } = await execFile('juliaup --version', { shell: true })
                const versionString = stdout.toString().trim()
                const versionPrefix = `Juliaup `

                if (!versionString.startsWith(versionPrefix)) {
                    this.diagnosticsOutput.appendLine('Something is wrong with juliaup binary path')
                    return undefined
                }
                this.actualJuliaupExePath = new JuliaupExecutable(versionString.slice(versionPrefix.length), 'juliaup')
            } catch {
                this.diagnosticsOutput.appendLine('Cannot find juliaup binary!')
                return undefined
            }
        }

        return this.actualJuliaupExePath
    }

    public async getActiveLaunguageServerJuliaExecutableAsync() {
        const actualJuliaExePath = await this.getActiveJuliaExecutableAsync()
        if (this.actualLanguageServerJuliaExePath === undefined) {
            return actualJuliaExePath
        } else {
            return this.actualLanguageServerJuliaExePath
        }
    }

    public async isJuliaup() {
        if (this.usingJuliaup === null) {
            await this.tryJuliaup()
        }

        return this.usingJuliaup
    }

    getExecutablePath() {
        const jlpath = vscode.workspace.getConfiguration('julia').get<string>('executablePath')
        return jlpath === '' ? undefined : jlpath
    }
    getLanguageServerExecutablePath() {
        const jlpath = vscode.workspace.getConfiguration('julia').get<string>('languageServerExecutablePath')
        return jlpath === '' ? undefined : jlpath
    }
}
