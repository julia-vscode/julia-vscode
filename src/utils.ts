import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import * as vslc from 'vscode-languageclient'
import { VersionedTextDocumentPositionParams } from './interactive/misc'
import { handleNewCrashReportFromException } from './telemetry'

export function constructCommandString(cmd: string, args: object = {}) {
    return `command:${cmd}?${encodeURIComponent(JSON.stringify(args))}`
}

export function getVersionedParamsAtPosition(document: vscode.TextDocument, position: vscode.Position): VersionedTextDocumentPositionParams {
    return {
        textDocument: vslc.TextDocumentIdentifier.create(document.uri.toString()),
        version: document.version,
        position
    }
}

export function setContext(contextKey: string, state: unknown) {
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
 * Provides a value for setting the `JULIA_NUM_THREADS` environment variable,
 * given the `julia.NumThreads` configuration, and the `JULIA_NUM_THREADS` env var.
 *
 * @remarks
 * The logic is:
 *
 * - if `julia.NumThreads` has a value, we return that, no matter what.
 *
 * - otherwise, if an env var `JULIA_NUM_THREADS` exists, we return that.
 *
 * - otherwise, we return undefined.
 *
 * @returns A string to set the value of `JULIA_NUM_THREADS`, or undefined.
 */
export function inferJuliaNumThreads(): string | undefined {
    const config: number | string | undefined = vscode.workspace.getConfiguration('julia').get('NumThreads') ?? undefined
    const env: string | undefined = process.env['JULIA_NUM_THREADS']

    if (config !== undefined) {
        return config.toString()
    }
    else if (env !== undefined) {
        return env
    }

    return undefined
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
 *  - ${workspaceFolderBasename}
 *  - ${workspaceFolder:<FOLDER_NAME>}  (For a multi-root project, use the first folder)
 *  - ${pathSeparator}
 *  - ${env:<ENVIRONMENT_VARIABLE>}
 *  - ${config:<CONFIG_VARIABLE>}
 *
 * See https://code.visualstudio.com/docs/editor/variables-reference for definitions of the
 * above.
 *
 * TODO: this replicates functionality present in core VSCode! The implementation of this
 *  function be replaced once this issue is resolved:
 *      https://github.com/microsoft/vscode/issues/46471
 */
export function parseVSCodeVariables(p?: string) {
    if (!p) {
        return p
    }
    p = p.replace(/\${userHome}/g, os.homedir())

    const workspace_paths = (vscode.workspace.workspaceFolders ?? []).map((folder) => {
        return folder.uri.fsPath
    })
    p = p.replace(/\${workspaceFolderBasename}/g, () => {
        if (workspace_paths.length === 0) {
            return null
        }
        return path.basename(workspace_paths[0])
    })
    p = p.replace(/\${workspaceFolder}/g, () => {
        // In the case of a multi-root workspace, we return the first one.
        return workspace_paths.length >= 1 ? workspace_paths[0] : null
    })
    p = p.replace(/\${workspaceFolder:(.*?)}/g, (_, desired_basename) => {
        const filtered_paths = workspace_paths.filter((workspace_path) => {
            return desired_basename === path.basename(workspace_path)
        })
        // If we have zero or more than one matches, we cannot proceed.
        return filtered_paths.length === 1 ? filtered_paths[0] : null
    })

    p = p.replace(/\${pathSeparator}/g, path.sep)
    p = p.replace(/\${env:(.*?)}/g, (_, variable) => {
        return process.env[variable] || ''
    })
    p = p.replace(/\${config:(.*?)}/g, (_, variable: string) => {
        const parts = variable.split('.')
        const leaf = parts.pop()
        const section = parts.length > 0 ? parts.join('.') : undefined
        return vscode.workspace.getConfiguration(section).get(leaf) || ''
    })
    return p
}
