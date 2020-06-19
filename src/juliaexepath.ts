import { exec } from 'child-process-promise'
import * as os from 'os'
import * as path from 'path'
import * as process from 'process'
import * as vscode from 'vscode'
import { onDidChangeConfig } from './extension'
import { setCurrentJuliaVersion, traceEvent } from './telemetry'

let g_actualJuliaExePath: string | undefined = undefined

async function trySetNewJuliaExePath(newPath: string) {
    if (newPath !== g_actualJuliaExePath) {
        try {
            const queriedVersion = (await exec(`"${newPath}" --version`)).stdout.trim()

            g_actualJuliaExePath = newPath
            setCurrentJuliaVersion(queriedVersion)
            traceEvent('configured-new-julia-binary')

            return true
        }
        catch (err) {
            g_actualJuliaExePath = undefined

            return false
        }
    }
}

export async function getJuliaExePath() {
    const homedir = os.homedir()

    if (!g_actualJuliaExePath) {
        const configuredPath = getExecutablePath()

        if (configuredPath==='') {

            let pathsToSearch = []
            if (process.platform === 'win32') {
                pathsToSearch = ['julia',
                    path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia', 'Julia-1.4.3', 'bin', 'julia.exe'),
                    path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia', 'Julia-1.4.2', 'bin', 'julia.exe'),
                    path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia', 'Julia-1.4.1', 'bin', 'julia.exe'),
                    path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia', 'Julia-1.4.0', 'bin', 'julia.exe'),
                    path.join(homedir, 'AppData', 'Local', 'Julia-1.3.1', 'bin', 'julia.exe'),
                    path.join(homedir, 'AppData', 'Local', 'Julia-1.3.0', 'bin', 'julia.exe'),
                    path.join(homedir, 'AppData', 'Local', 'Julia-1.2.0', 'bin', 'julia.exe'),
                    path.join(homedir, 'AppData', 'Local', 'Julia-1.1.1', 'bin', 'julia.exe'),
                    path.join(homedir, 'AppData', 'Local', 'Julia-1.1.0', 'bin', 'julia.exe'),
                    path.join(homedir, 'AppData', 'Local', 'Julia-1.0.6', 'bin', 'julia.exe'),
                    path.join(homedir, 'AppData', 'Local', 'Julia-1.0.5', 'bin', 'julia.exe'),
                    path.join(homedir, 'AppData', 'Local', 'Julia-1.0.4', 'bin', 'julia.exe'),
                    path.join(homedir, 'AppData', 'Local', 'Julia-1.0.3', 'bin', 'julia.exe'),
                    path.join(homedir, 'AppData', 'Local', 'Julia-1.0.2', 'bin', 'julia.exe'),
                    path.join(homedir, 'AppData', 'Local', 'Julia-1.0.1', 'bin', 'julia.exe'),
                    path.join(homedir, 'AppData', 'Local', 'Julia-1.0.0', 'bin', 'julia.exe')
                ]
            }
            else if (process.platform === 'darwin') {
                pathsToSearch = ['julia',
                    path.join(homedir, 'Applications', 'Julia-1.4.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                    path.join('/', 'Applications', 'Julia-1.4.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                    path.join(homedir, 'Applications', 'Julia-1.3.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                    path.join('/', 'Applications', 'Julia-1.3.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                    path.join(homedir, 'Applications', 'Julia-1.2.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                    path.join('/', 'Applications', 'Julia-1.2.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                    path.join(homedir, 'Applications', 'Julia-1.1.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                    path.join('/', 'Applications', 'Julia-1.1.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                    path.join(homedir, 'Applications', 'Julia-1.0.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                    path.join('/', 'Applications', 'Julia-1.0.app', 'Contents', 'Resources', 'julia', 'bin', 'julia')]
            }
            else {
                pathsToSearch = ['julia']
            }

            for (const p of pathsToSearch) {
                const foundJulia = await trySetNewJuliaExePath(p)

                if (foundJulia) {
                    break
                }
            }
        }
        else {
            await trySetNewJuliaExePath(configuredPath.replace('~', homedir))
        }
    }

    return g_actualJuliaExePath
}

function getExecutablePath() {
    return vscode.workspace.getConfiguration('julia')?.get<string>('executablePath', '')?.trim() ?? ''
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        onDidChangeConfig(event => {
            if (event.affectsConfiguration('julia.executablePath')) {
                g_actualJuliaExePath = undefined
            }
        })
    )
}
