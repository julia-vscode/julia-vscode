import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import * as vslc from 'vscode-languageclient'
import { VersionedTextDocumentPositionParams } from './interactive/misc'

export function setContext(contextKey: string, state: boolean) {
    vscode.commands.executeCommand('setContext', contextKey, state)
}

export function getVersionedParamsAtPosition(editor: vscode.TextEditor, position: vscode.Position): VersionedTextDocumentPositionParams {
    return {
        textDocument: vslc.TextDocumentIdentifier.create(editor.document.uri.toString()),
        version: editor.document.version,
        position
    }
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
    const config: number | null = vscode.workspace.getConfiguration('julia').get('NumThreads')
    const env: string | undefined = process.env['JULIA_NUM_THREADS']

    if (config !== null) {
        return config.toString()
    }
    else if (env !== undefined) {
        return env
    }
    else {
        return ''
    }
}
