import * as vscode from 'vscode'
import { ExecutableFeature, JuliaExecutable, JuliaProbeFailedError } from './executables'
import { onEvent } from './utils'
import * as telemetry from './telemetry'
import { promisify } from 'node:util'
import child_process from 'node:child_process'
const execFile = promisify(child_process.execFile)

let juliaPackagePath: string = null

let juliaDepotPath: string[] = null

let g_ExecutableFeature: ExecutableFeature

/**
 * Ask the user's Julia something about its depot and return what it printed.
 *
 * The invocation fails whenever the executable we were handed cannot actually run the
 * code: a version manager that built the channel path wrong (telemetry has a `julia.exe`
 * path with a depot-path separator in the middle of it), a depot that needs
 * `Pkg.instantiate()`, a stale precompiled image. None of those is a fault here, so the
 * rejection is turned into a {@link JuliaProbeFailedError}, which crash reporting ignores
 * and every caller of `ExecutableFeature` already has to handle, and the reason is written
 * to the output channel where the Julia it used was chosen.
 */
async function askJulia(juliaExecutable: JuliaExecutable, args: string[], code: string): Promise<string> {
    try {
        const res = await execFile(juliaExecutable.command, [...juliaExecutable.args, ...args, '-e', code], {
            env: {
                ...process.env,
                JULIA_VSCODE_INTERNAL: '1',
            },
        })
        return res.stdout.toString().trim()
    } catch (err) {
        telemetry.traceEvent('depot-probe-failed')
        g_ExecutableFeature.logExecutableDiagnostic(
            `[probe] '${juliaExecutable.command}' failed while being asked about its depot: ${err}`
        )
        throw new JuliaProbeFailedError(juliaExecutable.command, err)
    }
}

export async function getPkgPath() {
    if (juliaPackagePath === null) {
        const juliaExecutable = await g_ExecutableFeature.getExecutable()
        // TODO: there's got to be a better way to do this.
        juliaPackagePath = await askJulia(
            juliaExecutable,
            ['--history-file=no'],
            'using Pkg;println(get(ENV, "JULIA_PKG_DEVDIR", joinpath(Pkg.depots()[1], "dev")))'
        )
    }
    return juliaPackagePath
}

export async function getPkgDepotPath() {
    if (juliaDepotPath === null) {
        const juliaExecutable = await g_ExecutableFeature.getExecutable()
        let stdout: string
        try {
            stdout = await askJulia(
                juliaExecutable,
                ['--startup-file=no', '--history-file=no'],
                'using Pkg; println.(Pkg.depots())'
            )
        } catch (err) {
            if (!(err instanceof JuliaProbeFailedError)) {
                throw err
            }
            // The depots are only used to offer previously used environments to pick from,
            // so a Julia that cannot be asked means there are none to offer rather than
            // that the environment switcher cannot open. Deliberately not cached: the next
            // call tries again, in case the installation was repaired in between.
            vscode.window
                .showWarningMessage(
                    'Julia could not be asked where its depots are, so the environments stored in them are not listed. The Julia installation may be broken.',
                    'Show Output'
                )
                .then((choice) => {
                    if (choice === 'Show Output') {
                        vscode.commands.executeCommand('language-julia.showExecutableOutput')
                    }
                })
            return []
        }
        juliaDepotPath = stdout.split('\n')
    }
    return juliaDepotPath
}

export function activate(context: vscode.ExtensionContext, ExecutableFeature: ExecutableFeature) {
    g_ExecutableFeature = ExecutableFeature
    context.subscriptions.push(
        onEvent(vscode.workspace.onDidChangeConfiguration, (event: vscode.ConfigurationChangeEvent) => {
            if (event.affectsConfiguration('julia.executablePath')) {
                juliaPackagePath = null
            }
        })
    )
}
