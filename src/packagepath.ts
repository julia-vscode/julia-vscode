import { execFile } from 'promisify-child-process'
import * as vscode from 'vscode'
import { ExecutableFeature } from './executables'

let juliaPackagePath: string = null

let juliaDepotPath: string[] = null

let g_ExecutableFeature: ExecutableFeature

export async function getPkgPath() {
    if (juliaPackagePath === null) {
        const juliaExecutable = await g_ExecutableFeature.getExecutable()
        // TODO: there's got to be a better way to do this.
        const res = await execFile(
            juliaExecutable.command,
            [
                ...juliaExecutable.args,
                '--history-file=no',
                '-e',
                'using Pkg;println(get(ENV, "JULIA_PKG_DEVDIR", joinpath(Pkg.depots()[1], "dev")))',
            ],
            {
                env: {
                    ...process.env,
                    JULIA_VSCODE_INTERNAL: '1',
                },
            }
        )
        juliaPackagePath = res.stdout.toString().trim()
    }
    return juliaPackagePath
}

export async function getPkgDepotPath() {
    if (juliaDepotPath === null) {
        const juliaExecutable = await g_ExecutableFeature.getExecutable()
        const res = await execFile(
            juliaExecutable.command,
            [
                ...juliaExecutable.args,
                '--startup-file=no',
                '--history-file=no',
                '-e',
                'using Pkg; println.(Pkg.depots())',
            ],
            {
                env: {
                    ...process.env,
                    JULIA_VSCODE_INTERNAL: '1',
                },
            }
        )
        juliaDepotPath = res.stdout.toString().trim().split('\n')
    }
    return juliaDepotPath
}

export function activate(context: vscode.ExtensionContext, ExecutableFeature: ExecutableFeature) {
    g_ExecutableFeature = ExecutableFeature
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
            if (event.affectsConfiguration('julia.executablePath')) {
                juliaPackagePath = null
            }
        })
    )
}
