import { exists } from 'async-file'
import * as os from 'os'
import * as path from 'path'
import * as process from 'process'
import { execFile } from 'promisify-child-process'
import { parse } from 'semver'
import stringArgv from 'string-argv'
import * as vscode from 'vscode'
import { onDidChangeConfig } from './extension'
import { setCurrentJuliaVersion, traceEvent } from './telemetry'
import { resolvePath } from './utils'

export class JuliaExecutable {
    private _baseRootFolderPath: string | undefined

    constructor(public version: string, public file: string, public args: string[], public arch: string | undefined, public channel: string | undefined, public officialChannel: boolean) {
    }

    public getVersion() {
        return parse(this.version)
    }

    public async getBaseRootFolderPathAsync() {
        if (!this._baseRootFolderPath) {
            const result = await execFile(
                this.file,
                [
                    ...this.args,
                    '--startup-file=no',
                    '--history-file=no',
                    '-e',
                    'println(Sys.BINDIR)'
                ]
            )

            this._baseRootFolderPath = path.normalize(path.join(result.stdout.toString().trim(), '..', '..', 'share', 'julia', 'base'))
        }

        return this._baseRootFolderPath
    }

    public getCommand() {
        // TODO Properly escape things
        return [this.file, ...this.args].join(' ')
    }
}

export class JuliaExecutablesFeature {
    private actualJuliaExePath: JuliaExecutable | undefined
    private cachedJuliaExePaths: JuliaExecutable[] | undefined

    constructor(private context: vscode.ExtensionContext) {
        this.context.subscriptions.push(
            onDidChangeConfig(event => {
                if (event.affectsConfiguration('julia.executablePath')) {
                    this.actualJuliaExePath = undefined
                    this.cachedJuliaExePaths = undefined
                }
            })
        )
    }

    public dispose() {
    }

    async tryJuliaExePathAsync(newPath: string) {
        try {
            let parsedPath = ''
            let parsedArgs = []

            if (path.isAbsolute(newPath) && await exists(newPath)) {
                parsedPath = newPath
            }
            else {
                const resolvedPath = resolvePath(newPath, false)

                if (path.isAbsolute(resolvedPath) && await exists(resolvedPath)) {
                    parsedPath = resolvedPath
                }
                else {
                    const argv = stringArgv(newPath)

                    parsedPath = argv[0]
                    parsedArgs = argv.slice(1)
                }
            }
            const { stdout, } = await execFile(parsedPath, [...parsedArgs, '--version'])

            const versionStringFromJulia = stdout.toString().trim()

            const versionPrefix = `julia version `
            if (!versionStringFromJulia.startsWith(versionPrefix)) {
                return undefined
            }

            return new JuliaExecutable(versionStringFromJulia.slice(versionPrefix.length), parsedPath, parsedArgs, undefined, undefined, true)
        }
        catch {
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
        }
        else {
            return false
        }
    }

    getSearchPaths(): string[] {
        const homedir = os.homedir()
        let pathsToSearch = []
        if (process.platform === 'win32') {
            pathsToSearch = ['julia.exe',
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
                path.join(homedir, 'AppData', 'Local', 'Julia-1.0.6', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.0.5', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.0.4', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.0.3', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.0.2', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.0.1', 'bin', 'julia.exe'),
                path.join(homedir, 'AppData', 'Local', 'Julia-1.0.0', 'bin', 'julia.exe')
            ]
        }
        else if (process.platform === 'darwin') {
            pathsToSearch = ['julia',
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
                path.join('/', 'Applications', 'Julia-1.0.app', 'Contents', 'Resources', 'julia', 'bin', 'julia')]
        }
        else {
            pathsToSearch = ['julia']
        }
        return pathsToSearch
    }

    public async getJuliaExePathsAsync(): Promise<JuliaExecutable[]> {
        if (!this.cachedJuliaExePaths) {
            const searchPaths = this.getSearchPaths()

            const executables: JuliaExecutable[] = []
            executables.push(await this.getActiveJuliaExecutableAsync())
            await Promise.all(searchPaths.map(async (filePath) => {
                const newJuliaExecutable = await this.tryJuliaExePathAsync(filePath)

                if (newJuliaExecutable) {
                    executables.push(newJuliaExecutable)
                }
            }))

            // Remove duplicates.
            this.cachedJuliaExePaths = [...new Set(executables)]
            return this.cachedJuliaExePaths
        }

        return this.cachedJuliaExePaths
    }

    public async getActiveJuliaExecutableAsync() {
        if (!this.actualJuliaExePath) {
            const configPath = this.getExecutablePath()
            if (!configPath) {
                for (const p of this.getSearchPaths()) {
                    if (await this.tryAndSetNewJuliaExePathAsync(p)) {
                        break
                    }
                }
            }
            else {
                await this.tryAndSetNewJuliaExePathAsync(configPath)
            }
        }
        return this.actualJuliaExePath
    }

    getExecutablePath() {
        const jlpath = vscode.workspace.getConfiguration('julia').get<string>('executablePath')
        return jlpath === '' ? undefined : jlpath
    }
}
