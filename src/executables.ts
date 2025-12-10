import { exists } from 'async-file'
import * as os from 'os'
import * as path from 'path'
import * as process from 'process'
import { execFile } from 'promisify-child-process'
import * as semver from 'semver'
// import stringArgv from 'string-argv'
import * as vscode from 'vscode'
// import { JuliaGlobalDiagnosticOutputFeature } from './globalDiagnosticOutput'
// import { setCurrentJuliaVersion, traceEvent } from './telemetry'
import { resolvePath } from './utils'
import { installJuliaOrJuliaup } from './juliaupAutoInstall'
import { Mutex } from 'async-mutex'

const juliaVersionPrefix = 'julia version '

interface JuliaupInteractiveExecutableSpawnOptions {
    terminal?: unknown
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
        public version: string
    ) {}

    public async run(args: string[], options?: JuliaupInteractiveExecutableSpawnOptions): Promise<string> {
        const server = vscode.workspace.getConfiguration('julia').get<string>('juliaupServer')
        let env = process.env
        if (server) {
            env = { ...env, JULIAUP_SERVER: server }
        }
        if (options?.show) {
            throw new Error('not implemented')
        }
        if (options?.terminal) {
            throw new Error('not implemented')
        }

        try {
            console.log(`About to run '${this.command} ${args.join(' ')}'...`)
            const { stdout } = await execFile(this.command, args, { shell: true, env })

            const out = stdout.toString().trim()

            console.log(`Returned ${out}`)
            return out
        } catch (err) {
            console.error('Failed to run juliaup command: ', err)
            throw err
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
        this.installedPromise = new Promise(async (resolve) => {
            const stdout = await this.run(['api', 'getconfig1'])

            const installedVersions: JuliaupApiGetinfoReturn = JSON.parse(stdout)
            const defaultVersion = installedVersions.DefaultChannel
            const otherVersions = installedVersions.OtherChannels

            const channels: JuliaupChannel[] = []

            channels.push(toJuliaupChannel(defaultVersion, true))
            for (const version of otherVersions) {
                channels.push(toJuliaupChannel(version))
            }

            resolve(channels)
            this.installedPromise = undefined
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
        const channels = await requiredChannels()
        channels.add(channel)

        const choice = await vscode.window.showInformationMessage(
            `The extension is configured to use the following juliuap channels, but they are not installed: ${[...channels].join(', ')}. We can automatically add them for you.`,
            'Add required channels'
        )

        if (!choice) {
            throw new Error(`Channel ${channel} not installed`)
        }

        await this.addChannels(channels)

        vscode.window.showInformationMessage('All required juliaup channels where successfully installed!')
    }
}

export class JuliaExecutable {
    public command: string
    public version: string
    public args: string[]
    public channel: JuliaupChannel

    private _rootFolder: string

    constructor(commandOrChannel: string | JuliaupChannel, version?: string) {
        if (typeof commandOrChannel === 'string') {
            this.command = commandOrChannel
            this.version = version
            this.args = []
        } else {
            this.channel = commandOrChannel
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
}

export class ExecutableFeature {
    private outputChannel: vscode.OutputChannel = vscode.window.createOutputChannel('Julia Executables')

    private juliaupExecutableCache: Promise<JuliaupExecutable | undefined>
    private statusBarItem: vscode.StatusBarItem = vscode.window.createStatusBarItem()

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
    }

    // Interface
    public async getExecutable(): Promise<JuliaExecutable> {
        this.outputChannel.appendLine('Determining Julia executable for interactive usage...')

        let outputPrefix = '[config]  '

        const config = vscode.workspace.getConfiguration('julia').get<string>('executablePath')
        this.outputChannel.appendLine(
            outputPrefix + '`julia.executablePath` is ' + (config ? `set to '${config}'` : 'not set')
        )

        let configuredJuliaupChannel: string
        if (config) {
            // first we try to interpret the config as a path
            const exe = await this.juliaExecutableFromPathConfig(config, outputPrefix)
            if (exe) {
                this.outputChannel.appendLine(outputPrefix + `using ${exe.command} as executable`)
                return exe
            }

            // but if that doesn't work, the input is expected to be a juliaup channel
            // and of the form 'julia +$channel' or '+$channel'
            configuredJuliaupChannel = juliaChannelFromPathConfig(config)

            if (configuredJuliaupChannel) {
                this.outputChannel.appendLine(
                    outputPrefix +
                        `${config} is not a path, interpreting it as a juliaup channel '${configuredJuliaupChannel}`
                )
            } else {
                this.outputChannel.appendLine(outputPrefix + `${config} is invalid`)
            }
        }

        // At this point, we're sure we need to use juliaup. We may already have extraced the intended
        // channel from the configuration though
        outputPrefix = '[juliaup] '
        const juliaup = await this.getJuliaupExecutable()

        if (configuredJuliaupChannel) {
            try {
                const channel = await juliaup.getChannel(configuredJuliaupChannel)
                this.outputChannel.appendLine(outputPrefix + `using juliaup channel ${channel.name}`)
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
            return new JuliaExecutable(channel)
        } catch {
            this.outputChannel.appendLine(outputPrefix + `default juliaup channel is not installed`)
        }

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
                    this.outputChannel.appendLine(outputPrefix + `using ${exe.channel.name} as LS channel`)

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
        const juliaup = await this.getJuliaupExecutable()
        const channels = await juliaup.installed()
        const executables = new Set(channels.map((channel) => new JuliaExecutable(channel)))

        executables.add(await this.getExecutable())

        return [...executables]
    }

    // it's safe to call this multiple times; the return value is cached if successful
    // this will install juliaup if necessary
    public async getJuliaupExecutable(): Promise<JuliaupExecutable> {
        const outputPrefix = '[juliaup] '

        // caching the juliaup path is ok since we don't expect it to change much
        if (this.juliaupExecutableCache) {
            return await this.juliaupExecutableCache
        }

        this.juliaupExecutableCache = this.getJuliaupExecutableNoCache(outputPrefix)

        try {
            return await this.juliaupExecutableCache
        } catch {
            this.juliaupExecutableCache = undefined
        }
    }

    public async hasJuliaup(): Promise<boolean> {
        try {
            await this.getJuliaupExecutable()
            return true
        } catch {
            return false
        }
    }

    public dispose() {
        this.outputChannel.dispose()
        this.statusBarItem.dispose()
    }

    // Impl
    defaultJuliaupInstallLocation() {
        if (process.platform === 'win32') {
            // fill me in
            return ''
        } else {
            return path.join(os.homedir(), '.juliaup')
        }
    }

    defaultJuliaupBinaryLocation() {
        return path.join(this.defaultJuliaupInstallLocation(), 'bin', 'juliaup')
    }

    defaultJuliaupJuliaBinaryLocation() {
        return path.join(this.defaultJuliaupBinaryLocation(), 'bin', 'julia')
    }

    async tryGetJuliaVersion(command: string, args: string[] = []): Promise<string | undefined> {
        try {
            const { stdout } = await execFile(command, [...args, '--version'], {
                shell: true,
                env: { ...process.env, JULIA_VSCODE_INTERNAL: '1' },
            })
            const versionString = stdout.toString().trim()
            if (!versionString.startsWith(juliaVersionPrefix)) {
                this.outputChannel.appendLine(
                    `runs, but does not return a parsable version string. Got '${versionString}'`
                )
                return
            }

            const version = versionString.slice(juliaVersionPrefix.length)

            this.outputChannel.appendLine(`runs and resolves to ${version}`)
            return version
        } catch {
            this.outputChannel.appendLine(`failed to run`)
        }
    }

    async juliaExecutableFromPathConfig(config: string, outputPrefix = '') {
        const pathOptions = [config, resolvePath(config, false)]

        for (const pathOption of pathOptions) {
            if (path.isAbsolute(pathOption) && (await exists(pathOption))) {
                this.outputChannel.append(outputPrefix + `Trying ${pathOption} as an absolute path... `)
                const version = await this.tryGetJuliaVersion(pathOption)
                if (version) {
                    return new JuliaExecutable(pathOption, version)
                }
            }
        }
    }

    async getJuliaupExecutableNoCache(outputPrefix: string, tryInstall = true): Promise<JuliaupExecutable> {
        this.outputChannel.appendLine(outputPrefix + 'Finding juliaup executable...')

        console.log('getJuliaupExecutableNoCache')
        const spawnables = ['juliaup', this.defaultJuliaupBinaryLocation()]
        console.log('getJuliaupExecutableNoCache spawnables: ', spawnables)
        for (const cmd of spawnables) {
            this.outputChannel.append(outputPrefix + `-> Checking ${cmd}...`)
            try {
                const { stdout } = await execFile(cmd, ['--version'], { shell: true })
                const version = stdout.toString().trim()

                this.outputChannel.appendLine(` found 'juliaup' with version ${version}`)
                return new JuliaupExecutable(cmd, version)
            } catch {
                // TODO: maybe check the actual error here?
                this.outputChannel.appendLine(' not found')
            }
        }
        this.outputChannel.appendLine(outputPrefix + 'juliaup is not installed.')

        if (tryInstall) {
            this.outputChannel.appendLine(outputPrefix + 'Attempting user-guided installation...')
            await installJuliaOrJuliaup(this, 'julia', await requiredChannels())

            return await this.getJuliaupExecutableNoCache(outputPrefix, false)
        } else {
            throw new Error('juliaup not available')
        }
    }
}

async function requiredChannels() {
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
