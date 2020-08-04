import { exec } from 'child-process-promise'
import * as child_process from 'child_process'
import * as os from 'os'
import * as path from 'path'
import * as process from 'process'
import * as vscode from 'vscode'
import * as which from 'which'
import { onDidChangeConfig } from './extension'
import { setCurrentJuliaVersion, traceEvent } from './telemetry'

let actualJuliaExePath: string = null

async function setNewJuliaExePath(newPath: string) {
    actualJuliaExePath = newPath

    child_process.exec(`"${newPath}" --version`, (error, stdout, stderr) => {
        if (error) {
            actualJuliaExePath = null
            return
        }
        const version = stdout.trim()
        setCurrentJuliaVersion(version)

        traceEvent('configured-new-julia-binary')
    })
}

export async function getJuliaExePath() {
    if (actualJuliaExePath === null) {
        if (getExecutablePath() === null) {
            const homedir = os.homedir()
            let pathsToSearch = []
            if (process.platform === 'win32') {
                pathsToSearch = ['julia.exe',
                    path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia 1.5.0', 'bin', 'julia.exe'),
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
                    path.join(homedir, 'Applications', 'Julia-1.5.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
                    path.join('/', 'Applications', 'Julia-1.5.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
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
                try {
                    const res = await exec(`"${p}" --startup-file=no --history-file=no -e "println(Sys.BINDIR)"`)
                    if (p === 'julia' || p === 'julia.exe') {
                        // use full path
                        setNewJuliaExePath(path.join(res.stdout.trim(), p))
                    } else {
                        setNewJuliaExePath(p)
                    }
                    break
                }
                catch (e) {
                }
            }
        }
        else {
            if (getExecutablePath().includes(path.sep)) {
                setNewJuliaExePath(getExecutablePath().replace(/^~/, os.homedir()))
            } else {
                // resolve full path
                let fullPath: string | undefined = undefined
                try {
                    fullPath = await which(getExecutablePath())
                }
                catch (err) {
                }

                if (fullPath) {
                    setNewJuliaExePath(fullPath)
                }
            }
        }
    }
    return actualJuliaExePath
}

function getExecutablePath() {
    const section = vscode.workspace.getConfiguration('julia')
    const jlpath = section ? section.get('executablePath', null) : null
    return jlpath === '' ? null : jlpath
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        onDidChangeConfig(event => {
            if (event.affectsConfiguration('julia.executablePath')) {
                actualJuliaExePath = null
            }
        })
    )
}
