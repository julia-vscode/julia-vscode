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
import { installJuliaOrJuliaup } from './juliaupAutoInstall'

const juliaVersionPrefix = 'julia version '

interface JuliaupInteractiveExecutableSpawnOptions {
    terminal?: unknown
    show?: boolean
}

interface JuliaupChannel {
    name: string
    path: string
    args: string[]
    version: string
    arch: string
    isDefault: boolean
}

function toJuliaupChannel(info: JuliaupApiGetinfoReturnChannel, isDefault: boolean = false): JuliaupChannel {
    return {
        name: info.Name,
        path: info.Path,
        args: info.Args,
        version: info.Version,
        arch: info.Arch,
        isDefault,
    }
}

interface JuliaupApiGetinfoReturnChannel {
    Name: string
    Path: string
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
        if (options.show) {
            throw new Error('not implemented')
        }
        if (options.terminal) {
            throw new Error('not implemented')
        }

        const { stdout } = await execFile(this.command, args, { shell: true, env })

        return stdout.toString().trim()
    }

    public async add(channel: string, options?: JuliaupInteractiveExecutableSpawnOptions) {
        return await this.run(['add', channel], options)
    }

    public async installed(): Promise<JuliaupChannel[]> {
        const stdout = await this.run(['api', 'getconfig1'])

        const installedVersions: JuliaupApiGetinfoReturn = JSON.parse(stdout)
        const defaultVersion = installedVersions.DefaultChannel
        const otherVersions = installedVersions.OtherChannels

        const channels: JuliaupChannel[] = []

        channels.push(toJuliaupChannel(defaultVersion, true))
        for (const version of otherVersions) {
            channels.push(toJuliaupChannel(version))
        }

        return channels
    }

    public async getChannel(channel: string, autoInstall = true): Promise<JuliaupChannel> {
        const channels = await this.installed()

        const juChannel = channels.filter((c) => c.name === channel)

        if (juChannel?.length > 0) {
            return juChannel[0]
        }

        if (autoInstall) {
            const channels = await this.requiredChannels()
            channels.add(channel)
            await this.add(channel)
            return await this.getChannel(channel, false)
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
        const stdout = await this.run(['list'])
        // todo implement parsing
        return stdout
    }
}

export class JuliaExecutable {
    public command: string
    public version: string
    public channel: JuliaupChannel

    constructor(commandOrChannel: string | JuliaupChannel, version?: string) {
        if (typeof commandOrChannel === 'string') {
            this.command = commandOrChannel
            this.version = version
        } else {
            this.channel = commandOrChannel
            this.command = commandOrChannel.path
            this.version = commandOrChannel.version
        }
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
            configuredJuliaupChannel = this.juliaChannelFromPathConfig(config, outputPrefix)
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

        const channelConfig = vscode.workspace.getConfiguration('julia').get<string>('languageServerJuliaupChannel')
        this.outputChannel.appendLine(
            outputPrefix +
                '`julia.languageServerExecutablePath` is ' +
                (channelConfig ? `set to '${channelConfig}'` : 'not set')
        )

        const juliaup = await this.getJuliaupExecutable()

        outputPrefix = '[juliaup] '

        if (channelConfig) {
            try {
                const channel = await juliaup.getChannel(channelConfig)
                if (channel) {
                    const exe = new JuliaExecutable(channel)
                    this.outputChannel.appendLine(outputPrefix + `using ${exe.channel.name} as LS channel`)
                    return exe
                }
            } catch {
                this.outputChannel.appendLine(
                    outputPrefix + `configured juliaup channel ${channelConfig} is not available`
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
        return []
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

        return await this.juliaupExecutableCache
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
        return path.join(this.defaultJuliaupBinaryLocation(), 'bin', 'juliaup')
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

    juliaChannelFromPathConfig(config: string, outputPrefix = ''): string | undefined {
        let configuredJuliaupChannel: string
        const prefixes = ['julia +', '+']

        for (const prefix of prefixes) {
            if (config.startsWith(prefix)) {
                configuredJuliaupChannel = config.slice(prefix.length)
            }
        }

        if (configuredJuliaupChannel) {
            this.outputChannel.appendLine(
                outputPrefix +
                    `${config} is not a path, interpreting it as a juliaup channel '${configuredJuliaupChannel}`
            )
        } else {
            this.outputChannel.appendLine(outputPrefix + `${config} is invalid`)
        }

        return configuredJuliaupChannel
    }

    async getJuliaupExecutableNoCache(outputPrefix: string, tryInstall = true): Promise<JuliaupExecutable> {
        this.outputChannel.appendLine(outputPrefix + 'Finding juliaup executable...')
        const spawnables = ['juliaup', this.defaultJuliaupBinaryLocation()]

        for (const cmd in spawnables) {
            try {
                this.outputChannel.append(outputPrefix + `-> Checking ${cmd}...`)
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
            await installJuliaOrJuliaup()
        } else {
            throw new Error('juliaup not available')
        }

        return await this.getJuliaupExecutableNoCache(outputPrefix, false)
    }

    async requiredChannels() {
        const channels = new Set(['release'])

        const config = vscode.workspace.getConfiguration('julia')

        const lsChannel = config.get<string>('julia.languageServerJuliaupChannel')
        if (lsChannel) {
            channels.add(lsChannel)
        }

        const interactiveChannel = this.juliaChannelFromPathConfig(
            vscode.workspace.getConfiguration('julia').get<string>('executablePath')
        )
        if (interactiveChannel) {
            channels.add(interactiveChannel)
        }

        return channels
    }
}
