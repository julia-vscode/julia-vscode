import { realpath } from 'async-file'
import { exec } from 'child-process-promise'
import * as child_process from 'child_process'
import * as os from 'os'
import * as path from 'path'
import * as process from 'process'
import { valid } from 'semver'
import * as vscode from 'vscode'
import * as which from 'which'
import { onDidChangeConfig } from './extension'
import { setCurrentJuliaVersion, traceEvent } from './telemetry'
import { resolvePath } from './utils'

let actualJuliaExePath: JuliaExecutable = null

async function setNewJuliaExePath(newPath: string) {
    actualJuliaExePath = new JuliaExecutable('', newPath)

    const env = {
        JULIA_LANGUAGESERVER: '1'
    }

    child_process.exec(`"${newPath}" --version`, { env: env }, (error, stdout, stderr) => {
        if (error) {
            actualJuliaExePath = null
            return
        }
        const version = stdout.trim()
        setCurrentJuliaVersion(version)

        traceEvent('configured-new-julia-binary')
    })
}

function getSearchPaths(): string[] {
    const homedir = os.homedir()
    let pathsToSearch = []
    if (process.platform === 'win32') {
        pathsToSearch = ['julia.exe',
            path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.6.1', 'bin', 'julia.exe'),
            path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia-1.6.0', 'bin', 'julia.exe'),
            path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia 1.5.4', 'bin', 'julia.exe'),
            path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia 1.5.3', 'bin', 'julia.exe'),
            path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia 1.5.2', 'bin', 'julia.exe'),
            path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia 1.5.1', 'bin', 'julia.exe'),
            path.join(homedir, 'AppData', 'Local', 'Programs', 'Julia 1.5.0', 'bin', 'julia.exe'),
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
            path.join(homedir, 'Applications', 'Julia-1.6.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
            path.join('/', 'Applications', 'Julia-1.6.app', 'Contents', 'Resources', 'julia', 'bin', 'julia'),
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
    return pathsToSearch
}
export class JuliaExecutable {
    constructor(public version: string, public path: string) {
    }

    public getVersion() {
        return valid(this.version)
    }
}
let cachedJuliaExePaths: Promise<JuliaExecutable[]> | undefined
export async function getJuliaExePaths(): Promise<JuliaExecutable[]> {
    await getJuliaExePath()
    // If user has changed the julia executable, fetch all over again, possible user installed or changed something.
    if (Array.isArray(cachedJuliaExePaths) && actualJuliaExePath.path && actualJuliaExePath.version) {
        return [...cachedJuliaExePaths, actualJuliaExePath]
    }

    const getExecutables = async () => {
        const searchPaths = getSearchPaths()
        if (actualJuliaExePath.path && !actualJuliaExePath.version) {
            searchPaths.push(actualJuliaExePath.path)
        }
        const executables: JuliaExecutable[] = []
        await Promise.all(searchPaths
            .filter(filePath => path.isAbsolute(filePath))
            .map(async (filePath) => {
                try {
                    const res = await exec(`"${filePath}" --startup-file=no --history-file=no -e "println(VERSION);println(Sys.BINDIR)"`)
                    const output = res.stdout.trim()
                    if (!output) {
                        return
                    }
                    const [version, bindir] = output.split('\n').map(item => item.trim())
                    // Update version of the main executable.
                    if (actualJuliaExePath.path === filePath && !actualJuliaExePath.version) {
                        actualJuliaExePath.version = version
                    }
                    executables.push(new JuliaExecutable(version, path.join(bindir, path.basename(filePath))))
                } catch (ex) {
                    return
                }
            }))
        // Remove duplicates.
        return Array.from(new Map(executables.map(item => [item.path, item])).values())
    }

    cachedJuliaExePaths = getExecutables()
    return cachedJuliaExePaths
}
export async function getJuliaExePath() {
    if (actualJuliaExePath === null) {
        const configPath = getExecutablePath()
        if (configPath === null) {
            for (const p of getSearchPaths()) {
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
            let fullPath: string | undefined = undefined
            if (configPath.includes(path.sep)) {
                fullPath = resolvePath(configPath)
            } else {
                // resolve full path
                try {
                    fullPath = await which(configPath)
                }
                catch (err) {
                    console.debug('which failed to get the julia exe path')
                    console.debug(err)
                }

            }
            if (fullPath) {
                try {
                    fullPath = await realpath(fullPath)
                }
                catch (err) {
                    console.debug('realpath failed to resolve the julia exe path')
                    console.debug(err)
                }
                setNewJuliaExePath(fullPath)
            }
        }
    }
    return actualJuliaExePath.path
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
