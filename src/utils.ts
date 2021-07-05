import { exec, ExecException } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as tempDirectory from 'temp-dir'
import { uuid } from 'uuidv4'
import * as vscode from 'vscode'
import * as vslc from 'vscode-languageclient'
import { VersionedTextDocumentPositionParams } from './interactive/misc'
import { handleNewCrashReportFromException } from './telemetry'

export function constructCommandString(cmd: string, args: any = {}) {
    return `command:${cmd}?${encodeURIComponent(JSON.stringify(args))}`
}

export function getVersionedParamsAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
): VersionedTextDocumentPositionParams {
    return {
        textDocument: vslc.TextDocumentIdentifier.create(document.uri.toString()),
        version: document.version,
        position,
    }
}

export function setContext(contextKey: string, state: boolean) {
    vscode.commands.executeCommand('setContext', contextKey, state)
}

export function generatePipeName(pid: string, name: string) {
    if (process.platform === 'win32') {
        return '\\\\.\\pipe\\' + name + '-' + pid
    } else {
        return path.join(os.tmpdir(), name + '-' + pid)
    }
}

/**
 * Decides the final value to set the `JULIA_NUM_THREADS` environment variable to
 * given the `julia.NumThreads` configuration
 *
 * @remarks
 * The logic is:
 *
 * - if `julia.NumThreads` has a value, we return that, no matter what.
 *
 * - otherwise, if an env var `JULIA_NUM_THREADS` exists, we return that.
 *
 * - otherwise, we return an empty string as the value
 *
 * @returns A string to set the value of `JULIA_NUM_THREADS`
 */
export function inferJuliaNumThreads(): string {
    const config: number | undefined =
    vscode.workspace.getConfiguration('julia').get('NumThreads') ?? undefined
    const env: string | undefined = process.env['JULIA_NUM_THREADS']

    if (config !== undefined) {
        return config.toString()
    } else if (env !== undefined) {
        return env
    } else {
        return ''
    }
}

/**
 * Same as `vscode.commands.registerCommand`, but with added middleware.
 * Currently sends any uncaught errors in the command to crash reporting.
 */
export function registerCommand(cmd: string, f) {
    const fWrapped = (...args) => {
        try {
            return f(...args)
        } catch (err) {
            handleNewCrashReportFromException(err, 'Extension')
            throw err
        }
    }
    return vscode.commands.registerCommand(cmd, fWrapped)
}

export function resolvePath(p: string) {
    p = parseEnvVariables(p)
    p = p.replace(/^~/, os.homedir())
    p = path.normalize(p)
    return p
}

function parseEnvVariables(p: string) {
    return p.replace(/\${env:(.*?)}/g, (_, variable) => {
        return process.env[variable] || ''
    })
}

type FileLike = string | Buffer;
export class ClipboardManager {
    /**
     * @credits adapted from https://github.com/kufii/img-clipboard to support svgs.
     * @param context
     */

    constructor(private readonly context: vscode.ExtensionContext) { }

    public readonly CommandNotFoundErr = 127;

    public static isWayland() {
        return process.env.XDG_SESSION_TYPE === 'wayland'
    }

    private static run(
        cmd: string
    ): Promise<[error: ExecException, stdout: string, stderr: string]> {
        return new Promise((done) =>
            exec(cmd, { cwd: __dirname }, (...args) => done(args))
        )
    }

    private scriptsPaths() {
        return path.join(this.context.extensionPath, 'scripts', 'clipboard')
    }

    private static copyX11(file: FileLike) {
        return ClipboardManager.run(`xclip -sel clip -t image/png -i "${file}"`)
    }

    private static copyWayland(file: FileLike) {
        return ClipboardManager.run(`wl-copy < "${file}"`)
    }

    private static copyLinux(file: FileLike) {
        return ClipboardManager.isWayland()
            ? ClipboardManager.copyWayland(file)
            : ClipboardManager.copyX11(file)
    }

    private copyOsx(file: FileLike) {
        const osxScriptPath = path.join(this.scriptsPaths(), 'osx-copy-image')
        return ClipboardManager.run(`${osxScriptPath} "${file}"`)
    }

    private copyWindows(file: FileLike) {
        const windowsScriptPath = path.join(this.scriptsPaths(), 'file2clip.exe')
        return ClipboardManager.run(
            `powershell.exe -ExecutionPolicy Bypass Start-Process -NoNewWindow -FilePath ${windowsScriptPath} -ArgumentList "${file}"`
        )
    }

    copyImage(img: FileLike, isSvg: boolean) {
        const file =
      Buffer.isBuffer(img) || isSvg
          ? ClipboardManager._writeTempSync(img)
          : img
        return process.platform === 'win32'
            ? this.copyWindows(file)
            : process.platform === 'darwin'
                ? this.copyOsx(file)
                : ClipboardManager.copyLinux(file)
    }

    private static _writeTempSync(fileContent: FileLike) {
        const tempPath = path.join(tempDirectory, uuid())

        mkdirSync(path.dirname(tempPath), { recursive: true })
        writeFileSync(tempPath, fileContent)

        return tempPath
    }
}
