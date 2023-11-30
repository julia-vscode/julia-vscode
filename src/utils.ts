import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import * as vslc from 'vscode-languageclient'
import { VersionedTextDocumentPositionParams } from './interactive/misc'
import { handleNewCrashReportFromException } from './telemetry'

export function constructCommandString(cmd: string, args: any = {}) {
    return `command:${cmd}?${encodeURIComponent(JSON.stringify(args))}`
}

export function getVersionedParamsAtPosition(document: vscode.TextDocument, position: vscode.Position): VersionedTextDocumentPositionParams {
    return {
        textDocument: vslc.TextDocumentIdentifier.create(document.uri.toString()),
        version: document.version,
        position
    }
}

export function setContext(contextKey: string, state: any) {
    vscode.commands.executeCommand('setContext', contextKey, state)
}

export function generatePipeName(pid: string, name: string) {
    if (process.platform === 'win32') {
        return '\\\\.\\pipe\\' + name + '-' + pid
    }
    else {
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
    const config: number | string | undefined = vscode.workspace.getConfiguration('julia').get('NumThreads') ?? undefined
    const env: string | undefined = process.env['JULIA_NUM_THREADS']

    if (config !== undefined) {
        return config.toString()
    }
    else if (env !== undefined) {
        return env
    }
    else {
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
            throw (err)
        }
    }
    return vscode.commands.registerCommand(cmd, fWrapped)
}

export function wrapCrashReporting(f) {
    const fWrapped = (...args) => {
        try {
            return f(...args)
        } catch (err) {
            handleNewCrashReportFromException(err, 'Extension')
            throw (err)
        }
    }

    return fWrapped
}

export function resolvePath(p: string, normalize: boolean = true) {
    p = parseVSCodeVariables(p)
    p = p.replace(/^~/, os.homedir())
    p = normalize ? path.normalize(p) : p
    return p
}

/**
 * Parse a subset of VSCode 'variables' in `p`, and return a string with the replacements.
 *
 * Specifically, we support:
 *  - ${userHome}
 *  - ${workspaceFolder}
 *  - ${pathSeparator}
 *  - ${env:<ENVIRONMENT_VARIABLE>}
 *
 * See https://code.visualstudio.com/docs/editor/variables-reference for definitions of the
 * above.
 */
function parseVSCodeVariables(p: string) {
    p = p.replace(/\${userHome}/g, os.homedir())
    p = p.replace(/\${workspaceFolder}/g, (_) => {
        const workspace_folders = vscode.workspace.workspaceFolders
        // We do not support multi-root workspaces.
        return workspace_folders.length == 1 ? vscode.workspace.workspaceFolders[0].uri.fsPath : null;
    })
    p = p.replace(/\${pathSeparator}/g, path.sep);
    p = p.replace(/\${env:(.*?)}/g, (_, variable) => {
        return process.env[variable] || ''
    })
    return p
}
