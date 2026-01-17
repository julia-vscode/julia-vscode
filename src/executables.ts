import { exists } from 'async-file'
import * as os from 'os'
import * as path from 'path'
import * as process from 'process'
import { execFile } from 'promisify-child-process'
import * as semver from 'semver'
import * as vscode from 'vscode'
import { resolvePath } from './utils'
import { installJuliaOrJuliaup } from './juliaupAutoInstall'
import { Mutex } from 'async-mutex'
import { TaskRunner } from './taskRunnerTerminal'
import { ExecFileOptions } from 'child_process'

const juliaVersionPrefix = 'julia version '

interface JuliaupInteractiveExecutableSpawnOptions {
    show?: boolean
}

export interface JuliaupChannel {
    name: string
    file: string
    args: string[]
    version: string
    arch: string
    isDefault: boolean
}

function toJuliaupChannel(info: JuliaupApiGetinfoReturnChannel, isDefault: boolean = false): JuliaupChannel {
    return {
        name: info.Name,
        file: info.File,
        args: info.Args,
        version: info.Version,
        arch: info.Arch,
        isDefault,
    }
}

// Currently, juliaup channel aliases will have their File field set to `alias-to-$channel`,
// which we can resolve here. Luckily, we're guaranteed that each alias resolves to a
// proper channel, so we can just steal the File from there.
const aliasPrefix = 'alias-to-'
function resolveAliases(channels: JuliaupChannel[]) {
    return channels
        .map((channel) => {
            if (channel.file.startsWith(aliasPrefix)) {
                const aliasName = channel.file.slice(aliasPrefix.length)

                const aliasChannel = channels.find((c) => c.name === aliasName)

                if (!aliasChannel) {
                    vscode.window.showErrorMessage(
                        `Invalid juliaup configuration. Alias target '${aliasName}' not found.`
                    )
                    return undefined
                }

                return {
                    ...channel,
                    file: aliasChannel.file,
                    version: aliasChannel.version,
                }
            }

            return channel
        })
        .filter((channel) => channel !== undefined)
}

interface JuliaupApiGetinfoReturnChannel {
    Name: string
    File: string
    Args: string[]
    Version: string
    Arch: string
}

interface JuliaupApiGetinfoReturn {
    DefaultChannel?: JuliaupApiGetinfoReturnChannel
    OtherChannels: JuliaupApiGetinfoReturnChannel[]
}

export class JuliaupExecutable {
    constructor(
        public command: string,
        public version: string,
        private taskRunner: TaskRunner
    ) {}

    public async run(args: string[], options?: JuliaupInteractiveExecutableSpawnOptions): Promise<string> {
        const server = vscode.workspace.getConfiguration('julia').get<string>('juliaup.server')
        let env = process.env
        if (server) {
            env = { ...env, JULIAUP_SERVER: server }
        }
        if (options?.show) {
            const exitCode = await this.taskRunner.run(this.command, args, {
                env,
                echoMessage: true,
                onExitMessage: (exitCode) => {
                    if (exitCode === 0) {
                        return `\n\r\x1b[30;47m * \x1b[0m 'juliaup ${args.join(' ')}' ran successfully.\n\r\n\r`
                    } else {
                        return `\n\r\x1b[30;47m * \x1b[0m 'juliaup ${args.join(' ')}' failed to run.\n\r\n\r`
                    }
                },
            })

            if (exitCode !== 0) {
                throw new Error('Failed to run juliaup command')
            }
        } else {
            try {
                const { stdout } = await execFile(this.command, args, { shell: true, env })

                const out = stdout.toString().trim()

                return out
            } catch (err) {
                console.error('Failed to run juliaup command: ', err)
                throw err
            }
        }
    }

    public async add(channel: string, options?: JuliaupInteractiveExecutableSpawnOptions) {
        return await this.run(['add', channel], options)
    }

    private installedPromise: Promise<JuliaupChannel[]>
    public async installed(): Promise<JuliaupChannel[]> {
        if (this.installedPromise) {
            return await this.installedPromise
        }

        // eslint-disable-next-line no-async-promise-executor
        this.installedPromise = new Promise(async (resolve, reject) => {
            try {
                const stdout = await this.run(['api', 'getconfig1'])

                const installedVersions: JuliaupApiGetinfoReturn = JSON.parse(stdout)
                const defaultVersion = installedVersions.DefaultChannel
                const otherVersions = installedVersions.OtherChannels

                let channels: JuliaupChannel[] = []

                if (defaultVersion) {
                    channels.push(toJuliaupChannel(defaultVersion, true))
                }
                for (const version of otherVersions) {
                    channels.push(toJuliaupChannel(version))
                }

                channels = resolveAliases(channels)

                resolve(channels)
            } catch (err) {
                console.error(err)
                reject()
            } finally {
                this.installedPromise = undefined
            }
        })

        return await this.installedPromise
    }

    // we only want to run one of these at a time
    private getChannelMutex: Mutex = new Mutex()
    public async getChannel(channel: string, autoInstall = true): Promise<JuliaupChannel> {
        const channels = await this.installed()

        const juChannel = channels.filter((c) => c.name === channel)

        if (juChannel?.length > 0) {
            return juChannel[0]
        }

        if (autoInstall) {
            await this.getChannelMutex.acquire()
            try {
                try {
                    return await this.getChannel(channel, false)
                } catch {
                    // this is fine, but we need to double check because the channel
                    // might have just been added
                }

                await this.installRequired(channel)
                return await this.getChannel(channel, false)
            } finally {
                this.getChannelMutex.release()
            }
        } else {
            throw new Error(`Channel ${channel} not installed`)
        }
    }

    public async getDefaultChannel(): Promise<JuliaupChannel> {
        const channels = await this.installed()

        const juChannel = channels.filter((c) => c.isDefault)

        if (juChannel?.length > 0) {
            return juChannel[0]
        }

        throw new Error(`No default channel installed`)
    }

    public async list() {
        // const stdout = await this.run(['list'])
        throw new Error('not implemented')
    }

    public async addChannels(channels: Set<string>, options?: JuliaupInteractiveExecutableSpawnOptions) {
        for (const channel of channels) {
            await this.add(channel, options)
        }
    }

    async installRequired(channel: string) {
        const channels = requiredChannels()
        channels.add(channel)

        const choice = await vscode.window.showInformationMessage(
            `The extension is configured to use the following juliaup channels, but they are not installed: ${[...channels].join(', ')}. We can automatically add them for you.`,
            'Add required channels'
        )

        if (!choice) {
            throw new Error(`Channel ${channel} not installed`)
        }
        try {
            await this.addChannels(channels, { show: true })

            vscode.window.showInformationMessage('All required juliaup channels where successfully installed!')
        } catch {
            vscode.window.showErrorMessage('Failed to install some of the required juliaup channels.')
        }
    }
}

export class JuliaExecutable {
    public command: string
    public version: string
    public args: string[]
    public juliaupChannel: JuliaupChannel

    private _rootFolder: string

    constructor(commandOrChannel: string | JuliaupChannel, version?: string) {
        if (typeof commandOrChannel === 'string') {
            this.command = commandOrChannel
            this.version = version
            this.args = []
        } else {
            this.juliaupChannel = commandOrChannel
            this.command = commandOrChannel.file
            this.version = commandOrChannel.version
            this.args = commandOrChannel.args
        }
    }

    public async rootFolder(): Promise<string> {
        if (!this._rootFolder) {
            const result = await execFile(
                this.command,
                [...this.args, '--startup-file=no', '--history-file=no', '-e', 'println(Sys.BINDIR)'],
                {
                    env: {
                        ...process.env,
                        JULIA_VSCODE_INTERNAL: '1',
                    },
                }
            )

            this._rootFolder = path.normalize(
                path.join(result.stdout.toString().trim(), '..', 'share', 'julia', 'base')
            )
        }

        return this._rootFolder
    }

    public getVersion(): semver.SemVer {
        return semver.parse(this.version)
    }

    /**
     * @deprecated Use `.command` instead.
     */
    public get file() {
        return this.command
    }

    /**
     * @deprecated Use `.juliaupChannel.arch` instead.
     */
    public get arch() {
        return this.juliaupChannel?.arch
    }

    /**
     * @deprecated Use `.juliaupChannel.name` instead.
     */
    public get channel() {
        return this.juliaupChannel?.name
    }

    /**
     * @deprecated Use .rootFolder() instead.
     */
    public async getBaseRootFolderPathAsync() {
        return await this.rootFolder()
    }

    /**
     * @deprecated This does not properly escape its arguments. Use the `.command` and `.args` fields individually instead.
     */
    public getCommand(...args: string[]): string {
        return [this.command, ...this.args, ...args].join(' ')
    }
}

export class ExecutableFeature {
    private outputChannel: vscode.OutputChannel = vscode.window.createOutputChannel('Julia Executables')

    taskRunner: TaskRunner
    private juliaupExecutableCache: Promise<JuliaupExecutable | undefined>
    private statusBarItem: vscode.StatusBarItem = vscode.window.createStatusBarItem()

    private noJuliaupAlreadyNotified: boolean = false

    constructor(private context: vscode.ExtensionContext) {
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
                if (
                    event.affectsConfiguration('julia.executablePath') ||
                    event.affectsConfiguration('julia.languageServerExecutablePath')
                ) {
                    // DO SOMETHING
                }
            })
        )
        this.taskRunner = new TaskRunner('Julia Installer', new vscode.ThemeIcon('tools'))
    }

    // Interface
    public async getExecutable(tryInstall: boolean = false): Promise<JuliaExecutable> {
        this.outputChannel.appendLine('Determining Julia executable for interactive usage...')

        let outputPrefix = '[config]  '

        const config = vscode.workspace.getConfiguration('julia').get<string>('executablePath')
        this.outputChannel.appendLine(
            outputPrefix + '`julia.executablePath` is ' + (config ? `set to '${config}'` : 'not set')
        )

        const options = [config]
        if (os.platform() === 'win32') {
            options.push('julia.exe', 'julia.cmd')
        }
        options.push('julia')

        let configuredJuliaupChannel: string
        for (const option of options) {
            if (!option) {
                continue
            }

            // first we try to interpret the config as a path
            const exe = await this.juliaExecutableFromPathConfig(option, outputPrefix)
            if (exe) {
                this.outputChannel.appendLine(outputPrefix + `using '${exe.command}' (v${exe.version}) as executable`)
                this.setJuliaInstalled(true)

                return exe
            }

            // and then just try to spawn it
            const version = await this.tryGetJuliaVersion(option, [], outputPrefix)

            if (version) {
                const exe = new JuliaExecutable(option, version)
                this.outputChannel.appendLine(outputPrefix + `using '${exe.command}' (v${exe.version}) as executable`)
                this.setJuliaInstalled(true)

                return exe
            } else {
                this.outputChannel.appendLine(outputPrefix + `'${option}' can not be started`)
            }

            // but if neither of those work, the input is expected to be a juliaup channel
            // and of the form 'julia +$channel' or '+$channel'
            configuredJuliaupChannel = juliaChannelFromPathConfig(option)

            if (configuredJuliaupChannel) {
                this.outputChannel.appendLine(
                    outputPrefix +
                        `${option} is not a path, interpreting it as a julia channel '${configuredJuliaupChannel}'`
                )
                break
            } else {
                this.outputChannel.appendLine(outputPrefix + `'${option}' is an invalid juliaup channel`)
            }
        }

        // At this point, we're sure we need to use juliaup. We may already have extraced the intended
        // channel from the configuration though
        outputPrefix = '[juliaup] '
        const juliaup = await this.getJuliaupExecutable(tryInstall)

        if (configuredJuliaupChannel) {
            try {
                const channel = await juliaup.getChannel(configuredJuliaupChannel)
                this.outputChannel.appendLine(outputPrefix + `using juliaup channel ${channel.name}`)
                this.setJuliaInstalled(true)

                return new JuliaExecutable(channel)
            } catch {
                this.outputChannel.appendLine(
                    outputPrefix + `configured juliaup channel ${configuredJuliaupChannel} not installed`
                )
            }
        }

        try {
            const channel = await juliaup.getDefaultChannel()
            this.outputChannel.appendLine(outputPrefix + `using default juliaup channel ${channel.name}`)
            this.setJuliaInstalled(true)

            return new JuliaExecutable(channel)
        } catch {
            this.outputChannel.appendLine(outputPrefix + `default juliaup channel is not installed`)
        }

        this.setJuliaInstalled(false)
        this.outputChannel.appendLine('!!! Julia was not found. Most extension features will be nonfunctional.')
        throw new Error('Julia not installed')
    }

    public async getLsExecutable(): Promise<JuliaExecutable> {
        // precedence: julia.languageServerExecutablePath > julia.languageServerJuliaupChannel > julia +release
        this.outputChannel.appendLine('Determining Julia executable for the language server...')

        let outputPrefix = '[config]  '

        const pathConfig = vscode.workspace.getConfiguration('julia').get<string>('languageServerExecutablePath')
        this.outputChannel.appendLine(
            outputPrefix +
                '`julia.languageServerExecutablePath` is ' +
                (pathConfig ? `set to '${pathConfig}'` : 'not set')
        )

        if (pathConfig) {
            const exe = await this.juliaExecutableFromPathConfig(pathConfig, outputPrefix)
            if (exe) {
                this.outputChannel.appendLine(outputPrefix + `using ${exe.command} as LS executable`)
                return exe
            }

            const version = await this.tryGetJuliaVersion(pathConfig, [], outputPrefix)

            if (version) {
                const exe = new JuliaExecutable(pathConfig, version)
                this.outputChannel.appendLine(outputPrefix + `using '${exe.command}' (v${exe.version}) as executable`)

                return exe
            } else {
                this.outputChannel.appendLine(outputPrefix + `'${pathConfig}' can not be started`)
            }
        }

        // Either we can use juliaup's release channel here (preferred option) or we try re-using
        // the global `julia.executablePath` setting if juliaup is not installed:
        const hasJuliaup = await this.hasJuliaup()
        if (!hasJuliaup) {
            this.outputChannel.appendLine(outputPrefix + `juliaup not installed, trying the non-LS path`)

            const exe = await this.getExecutable(false)
            if (exe) {
                this.outputChannel.appendLine(outputPrefix + `using ${exe.command} as LS executable`)

                if (
                    !this.noJuliaupAlreadyNotified &&
                    vscode.workspace.getConfiguration('julia').get('juliaup.install.hint')
                ) {
                    this.noJuliaupAlreadyNotified = true

                    const install = 'Install'
                    const doNotShowAgain = 'Do not show again'
                    vscode.window
                        .showWarningMessage(
                            'Juliaup is the recommended version manager for Julia and used to ensure that the language server runs with a well known Julia version.',
                            install,
                            doNotShowAgain
                        )
                        .then((choice) => {
                            if (choice === doNotShowAgain) {
                                // never do this again
                                vscode.workspace
                                    .getConfiguration('julia')
                                    .update('juliaup.install.hint', false, vscode.ConfigurationTarget.Global)
                            } else if (choice === install) {
                                // trigger installation
                                this.getJuliaupExecutable()
                            }
                        })
                }

                return exe
            }
        }

        let configuredChannel = process.env.JULIA_VSCODE_LANGUAGESERVER_CHANNEL
        this.outputChannel.appendLine(
            outputPrefix +
                '`JULIA_VSCODE_LANGUAGESERVER_CHANNEL` is ' +
                (configuredChannel ? `set to '${configuredChannel}'` : 'not set')
        )

        if (!configuredChannel) {
            configuredChannel = vscode.workspace.getConfiguration('julia').get<string>('languageServerJuliaupChannel')
            this.outputChannel.appendLine(
                outputPrefix +
                    '`julia.languageServerJuliaupChannel` is ' +
                    (configuredChannel ? `set to '${configuredChannel}'` : 'not set')
            )
        }

        const juliaup = await this.getJuliaupExecutable()

        outputPrefix = '[juliaup] '

        if (configuredChannel) {
            try {
                const channel = await juliaup.getChannel(configuredChannel)
                if (channel) {
                    const exe = new JuliaExecutable(channel)
                    this.outputChannel.appendLine(outputPrefix + `using ${exe.juliaupChannel.name} as LS channel`)

                    return exe
                }
            } catch {
                this.outputChannel.appendLine(
                    outputPrefix + `configured juliaup channel ${configuredChannel} is not available`
                )
            }
        }

        try {
            const channel = await juliaup.getChannel('release')
            this.outputChannel.appendLine(outputPrefix + `using default juliaup channel ${channel.name}`)
            return new JuliaExecutable(channel)
        } catch {
            this.outputChannel.appendLine(outputPrefix + `release juliaup channel is not installed`)
        }

        this.outputChannel.appendLine('!!! Julia was not found. Most extension features will be nonfunctional.')
        throw new Error('Julia not installed')
    }

    public async getExecutables(): Promise<JuliaExecutable[]> {
        const executables = []
        executables.push(await this.getExecutable(true))

        if (await this.hasJuliaup()) {
            const juliaup = await this.getJuliaupExecutable()
            const channels = await juliaup.installed()

            executables.push(channels.map((channel) => new JuliaExecutable(channel)))
        }

        return executables.filter((val, ind, self) => {
            return (
                ind ===
                self.findIndex((val2) => {
                    if (val.juliaupChannel && val2.juliaupChannel) {
                        return val.juliaupChannel.name === val2.juliaupChannel.name
                    } else {
                        return val.command === val2.command
                    }
                })
            )
        })
    }

    // it's safe to call this multiple times; the return value is cached if successful
    // this will install juliaup if necessary
    public async getJuliaupExecutable(tryInstall = true): Promise<JuliaupExecutable> {
        // caching the juliaup path is ok since we don't expect it to change much
        if (this.juliaupExecutableCache) {
            const exe = await this.juliaupExecutableCache
            if (exe) {
                this.setJuliaupInstalled(true)

                return exe
            }
        }

        this.juliaupExecutableCache = this.getJuliaupExecutableNoCache(tryInstall)

        try {
            return await this.juliaupExecutableCache
        } catch (err) {
            this.juliaupExecutableCache = undefined
            throw err
        }
    }

    public async hasJuliaup(): Promise<boolean> {
        try {
            await this.getJuliaupExecutable(false)
            return true
        } catch {
            return false
        }
    }

    public async hasJulia(): Promise<boolean> {
        try {
            await this.getExecutable(false)
            return true
        } catch {
            return false
        }
    }

    public dispose() {
        this.outputChannel.dispose()
        this.statusBarItem.dispose()
    }

    public setJuliaInstalled(isInstalled: boolean) {
        vscode.commands.executeCommand('setContext', 'julia.juliaInstalled', isInstalled)
    }

    public setJuliaupInstalled(isInstalled: boolean) {
        vscode.commands.executeCommand('setContext', 'julia.juliaupInstalled', isInstalled)
    }

    // Impl
    installRoot() {
        if (process.platform === 'win32') {
            return path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps')
        } else {
            return path.join(os.homedir(), '.juliaup')
        }
    }

    defaultJuliaupBinaryLocation() {
        const root = this.installRoot()
        if (process.platform === 'win32') {
            return path.join(root, 'juliaup.exe')
        }
        return path.join(root, 'bin', 'juliaup')
    }

    defaultJuliaupJuliaBinaryLocation() {
        const root = this.installRoot()
        if (process.platform === 'win32') {
            return path.join(root, 'julia.exe')
        }
        return path.join(root, 'bin', 'julia')
    }

    async tryGetJuliaVersion(
        command: string,
        args: string[] = [],
        outputPrefix: string = ''
    ): Promise<string | undefined> {
        try {
            const options: ExecFileOptions = {
                env: { ...process.env, JULIA_VSCODE_INTERNAL: '1' },
            }
            const workspace = vscode.workspace.workspaceFolders?.[0]

            if (workspace?.uri?.fsPath) {
                options.cwd = workspace.uri.fsPath
            }

            const { stdout } = await execFile(command, [...args, '--version'], options)
            const versionString = stdout.toString().trim()
            if (!versionString.startsWith(juliaVersionPrefix)) {
                this.outputChannel.appendLine(
                    outputPrefix +
                        `'${command}' runs, but does not return a parsable version string. Got '${versionString}'`
                )
                return
            }

            const version = versionString.slice(juliaVersionPrefix.length)

            this.outputChannel.appendLine(outputPrefix + `'${command}' runs and resolves to ${version}`)
            return version
        } catch {
            this.outputChannel.appendLine(outputPrefix + `'${command}' failed to run`)
        }
    }

    async juliaExecutableFromPathConfig(config: string, outputPrefix = '') {
        const pathOptions = [config, resolvePath(config, false)]

        for (const pathOption of pathOptions) {
            if (path.isAbsolute(pathOption) && (await exists(pathOption))) {
                this.outputChannel.appendLine(outputPrefix + `Trying ${pathOption} as an absolute path... `)
                const version = await this.tryGetJuliaVersion(pathOption, [], outputPrefix)
                if (version) {
                    return new JuliaExecutable(pathOption, version)
                }
            }
        }
    }

    async getJuliaupExecutableNoCache(tryInstall = true): Promise<JuliaupExecutable> {
        const outputPrefix = '[juliaup] '

        this.outputChannel.appendLine(outputPrefix + 'Finding juliaup executable...')

        const spawnables = [this.defaultJuliaupBinaryLocation(), 'juliaup']

        for (const cmd of spawnables) {
            this.outputChannel.appendLine(outputPrefix + `  Checking ${cmd}...`)
            try {
                const { stdout } = await execFile(cmd, ['--version'])
                const version = stdout.toString().trim()

                this.outputChannel.appendLine(`  ${cmd}: found 'juliaup' with version ${version}`)
                this.setJuliaupInstalled(true)

                return new JuliaupExecutable(cmd, version, this.taskRunner)
            } catch {
                // TODO: maybe check the actual error here?
                this.outputChannel.appendLine(`  ${cmd}: not a juliaup executable`)
            }
        }
        this.outputChannel.appendLine(outputPrefix + '! juliaup is not installed.')

        if (tryInstall) {
            this.outputChannel.appendLine(outputPrefix + '-> Starting user-guided installation...')
            const exitCode = await installJuliaOrJuliaup(this, 'julia', requiredChannels())

            if (exitCode === 0) {
                vscode.window.showInformationMessage('Julia and the required juliaup channels are now fully installed!')

                return await this.getJuliaupExecutableNoCache(false)
            } else if (exitCode === 1) {
                vscode.window.showErrorMessage('Failed to install Julia and the required juliaup channels!')
                this.setJuliaupInstalled(false)

                throw new Error('juliaup not available')
            }
        } else {
            this.setJuliaupInstalled(false)

            throw new Error('juliaup not available')
        }
    }
}

function requiredChannels() {
    const channels = new Set(['release'])

    const lsEnvChannel = process.env.JULIA_VSCODE_LANGUAGESERVER_CHANNEL
    if (lsEnvChannel) {
        channels.add(lsEnvChannel)
    }

    const config = vscode.workspace.getConfiguration('julia')

    const lsChannel = config.get<string>('languageServerJuliaupChannel')
    if (lsChannel) {
        channels.add(lsChannel)
    }

    const interactiveChannel = juliaChannelFromPathConfig(config.get<string>('executablePath'))
    if (interactiveChannel) {
        channels.add(interactiveChannel)
    }

    return channels
}

function juliaChannelFromPathConfig(config: string): string | undefined {
    let configuredJuliaupChannel: string
    const prefixes = ['julia +', '+']

    for (const prefix of prefixes) {
        if (config.startsWith(prefix)) {
            configuredJuliaupChannel = config.slice(prefix.length)
        }
    }

    return configuredJuliaupChannel
}
