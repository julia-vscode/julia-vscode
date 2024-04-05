import { join } from 'path'
import { execFile } from 'promisify-child-process'
import * as vscode from 'vscode'
import { onDidChangeConfig } from './extension'
import { JuliaExecutablesFeature } from './juliaexepath'

let juliaPackagePath: string = null

let juliaDepotPath: string[] = null

let g_juliaExecutablesFeature: JuliaExecutablesFeature

export async function getPkgPath() {
    if (juliaPackagePath === null) {
        const juliaExecutable = await g_juliaExecutablesFeature.getActiveJuliaExecutableAsync()
        // TODO: there's got to be a better way to do this.
        const res = await execFile(
            juliaExecutable.file,
            [
                '--startup-file=no',
                '--history-file=no',
                '-e',
                'using Pkg; println(Pkg.depots()[1])'
            ],
            {
                env: {
                    ...process.env,
                    JULIA_VSCODE_INTERNAL: '1',
                }
            }
        )
        juliaPackagePath = join(res.stdout.toString().trim(), 'dev')
    }
    return juliaPackagePath
}

export async function getPkgDepotPath() {
    if (juliaDepotPath === null) {
        const juliaExecutable = await g_juliaExecutablesFeature.getActiveJuliaExecutableAsync()
        const res = await execFile(
            juliaExecutable.file,
            [
                '--startup-file=no',
                '--history-file=no',
                '-e',
                'using Pkg; println.(Pkg.depots())'
            ],
            {
                env: {
                    ...process.env,
                    JULIA_VSCODE_INTERNAL: '1',
                }
            }
        )
        juliaDepotPath = res.stdout.toString().trim().split('\n')
    }
    return juliaDepotPath
}

export function activate(context: vscode.ExtensionContext, juliaExecutablesFeature: JuliaExecutablesFeature) {
    g_juliaExecutablesFeature = juliaExecutablesFeature
    context.subscriptions.push(
        onDidChangeConfig(event => {
            if (event.affectsConfiguration('julia.executablePath')) {
                juliaPackagePath = null
            }
        })
    )
}
