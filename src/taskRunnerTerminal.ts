import * as vscode from 'vscode'
import { join as joinPath } from 'path'

// https://github.com/swiftlang/vscode-swift/blob/a19d0b1bfe2d7a1740f8cf94c6503f584e34c71b/src/utilities/native.ts
//
// To not electron-rebuild for every platform and arch, we want to
// use the asar bundled native module. Taking inspiration from
// https://github.com/microsoft/node-pty/issues/582
export function requireNativeModule<T>(id: string): T {
    if (vscode.env.remoteName) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require(joinPath(vscode.env.appRoot, 'node_modules', id))
    }
    // https://github.com/microsoft/vscode/commit/a162831c17ad0d675f1f0d5c3f374fd1514f04b5
    // VSCode has moved node-pty out of asar bundle
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require(joinPath(vscode.env.appRoot, 'node_modules.asar', id))
    } catch {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return require(joinPath(vscode.env.appRoot, 'node_modules', id))
    }
}

const { spawn } = requireNativeModule<{ spawn }>('node-pty')

interface JuliaPTYOptions {
    echoCommand?: boolean
    onExitMessage?: (exitCode: number | void) => string | undefined
    showDefaultErrorMessage?: boolean
}

export interface TaskRunnerTerminalOptions extends JuliaPTYOptions {
    cwd?: string | vscode.Uri
    env?: { [key: string]: string }
    shellIntegrationNonce?: string
    message?: string
    iconPath?: vscode.IconPath
    hideFromUser?: boolean
}

export class TaskRunnerTerminal {
    public terminal: vscode.Terminal
    private onDidCloseEmitter = new vscode.EventEmitter<vscode.Terminal>()
    public onDidClose: vscode.Event<vscode.Terminal> = this.onDidCloseEmitter.event

    private disposables: vscode.Disposable[] = []

    constructor(name: string, shellPath: string, shellArgs: string[], opts: TaskRunnerTerminalOptions = {}) {
        const proc = new JuliaProcess(shellPath, shellArgs, { env: opts.env })
        const pty = new JuliaPTY(proc, opts)

        const options: vscode.ExtensionTerminalOptions = {
            name: name,
            isTransient: true,
            pty: pty,
            iconPath: new vscode.ThemeIcon('tools'),
            ...opts,
        }

        this.terminal = vscode.window.createTerminal(options)

        this.terminal.show()
    }

    show(preserveFocus?: boolean) {
        this.terminal?.show(preserveFocus)
    }

    hide() {
        this.terminal?.hide()
    }

    private _dispose() {
        this.disposables?.forEach((d) => d?.dispose())
    }

    dispose() {
        this.terminal?.dispose()
        this._dispose()
    }
}

class CloseHandler implements vscode.Disposable {
    private readonly closeEmitter: vscode.EventEmitter<number | void> = new vscode.EventEmitter<number | void>()
    private exitCode: number | void | undefined
    private closeTimeout: NodeJS.Timeout | undefined

    event = this.closeEmitter.event

    handle(exitCode: number | void) {
        this.exitCode = exitCode
        this.queueClose()
    }

    reset() {
        if (this.closeTimeout) {
            clearTimeout(this.closeTimeout)
            this.queueClose()
        }
    }

    dispose() {
        this.closeEmitter.dispose()
    }

    private queueClose() {
        this.closeTimeout = setTimeout(() => {
            this.closeEmitter.fire(this.exitCode)
        }, 250)
    }
}

export class JuliaProcess implements vscode.Disposable {
    private readonly spawnEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>()
    private readonly writeEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter<string>()
    private readonly errorEmitter: vscode.EventEmitter<Error> = new vscode.EventEmitter<Error>()
    private readonly closeHandler: CloseHandler = new CloseHandler()
    private disposables: vscode.Disposable[] = []

    private spawnedProcess?

    constructor(
        public readonly command: string,
        public readonly args: string[],
        private options: vscode.ProcessExecutionOptions = {}
    ) {
        this.disposables.push(this.spawnEmitter, this.writeEmitter, this.errorEmitter, this.closeHandler)
    }

    spawn(): void {
        try {
            const isWindows = process.platform === 'win32'
            // The pty process hangs on Windows when debugging the extension if we use conpty
            // See https://github.com/microsoft/node-pty/issues/640
            const useConpty = isWindows && process.env['DEBUG_MODE'] === 'true' ? false : true
            this.spawnedProcess = spawn(this.command, this.args, {
                cwd: this.options.cwd,
                env: { ...process.env, ...this.options.env },
                useConpty,
                // https://github.com/swiftlang/vscode-swift/issues/1074
                // Causing weird truncation issues
                cols: isWindows ? 4096 : undefined,
            })
            this.spawnEmitter.fire()
            this.spawnedProcess.onData((data) => {
                this.writeEmitter.fire(data)
                this.closeHandler.reset()
            })
            this.spawnedProcess.onExit((event) => {
                if (event.signal) {
                    this.closeHandler.handle(event.signal)
                } else if (typeof event.exitCode === 'number') {
                    this.closeHandler.handle(event.exitCode)
                } else {
                    this.closeHandler.handle()
                }
            })
            this.disposables.push(
                this.onDidClose(() => {
                    this.dispose()
                })
            )
        } catch (error) {
            this.errorEmitter.fire(new Error(`${error}`))
            this.closeHandler.handle()
        }
    }

    handleInput(s: string): void {
        this.spawnedProcess?.write(s)
    }

    terminate(signal?: NodeJS.Signals): void {
        if (!this.spawnedProcess) {
            return
        }
        this.spawnedProcess.kill(signal)
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        // https://github.com/swiftlang/vscode-swift/issues/1074
        // Causing weird truncation issues
        if (process.platform === 'win32') {
            return
        }
        this.spawnedProcess?.resize(dimensions.columns, dimensions.rows)
    }

    dispose() {
        this.disposables.forEach((d) => d.dispose())
    }

    onDidSpawn: vscode.Event<void> = this.spawnEmitter.event

    onDidWrite: vscode.Event<string> = this.writeEmitter.event

    onDidThrowError: vscode.Event<Error> = this.errorEmitter.event

    onDidClose: vscode.Event<number | void> = this.closeHandler.event
}

export class JuliaPTY implements vscode.Pseudoterminal, vscode.Disposable {
    private writeEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter()
    onDidWrite: vscode.Event<string> = this.writeEmitter.event

    private closeEmitter: vscode.EventEmitter<number | void> = new vscode.EventEmitter()
    onDidClose?: vscode.Event<number | void> = this.closeEmitter.event

    private disposables: vscode.Disposable[] = []

    private isClosed: boolean = false
    private exitCode: number | void

    constructor(
        private proc: JuliaProcess,
        private options: JuliaPTYOptions
    ) {}

    open(initialDimensions?: vscode.TerminalDimensions): void {
        this.disposables.push(
            this.proc.onDidSpawn(() => {
                if (this.options.echoCommand !== false) {
                    const exec = [this.proc.command, ...this.proc.args].join(' ')
                    this.writeEmitter.fire(`\x1b[3047m * \x1b[0m Executing ${exec}\n\n\r`)
                }
            }),
            this.proc.onDidWrite((data) => {
                this.writeEmitter.fire(data.replace(/\n(\r)?/g, '\n\r'))
            }),
            this.proc.onDidThrowError((err) => {
                vscode.window.showErrorMessage(`Process failed: ${err}`)

                this.closeEmitter.fire()
                this.dispose()
            }),
            this.proc.onDidClose((ev) => {
                const msg = this.options?.onExitMessage?.(ev)

                if (msg) {
                    this.isClosed = true
                    this.exitCode = ev
                    this.writeEmitter.fire(msg)
                } else {
                    // we probably want to hide the vscode-native error pop-up by default
                    this.closeEmitter.fire(this.options?.showDefaultErrorMessage ? ev : undefined)
                    this.dispose()
                }
            })
        )

        this.proc.spawn()

        if (initialDimensions) {
            this.setDimensions(initialDimensions)
        }
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        this.proc?.setDimensions(dimensions)
    }

    close(): void {
        this.proc.terminate()
        this.writeEmitter.dispose()
        this.closeEmitter.dispose()
    }

    handleInput(data: string): void {
        this.proc?.handleInput(data)

        if (this.isClosed) {
            this.closeEmitter.fire(this.options?.showDefaultErrorMessage ? this.exitCode : undefined)
            this.dispose()
        }
    }

    dispose() {
        for (const disposable of this.disposables) {
            disposable.dispose()
        }
    }
}
