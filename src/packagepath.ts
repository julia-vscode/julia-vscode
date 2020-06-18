import { exec } from 'child-process-promise'
import { join } from 'path'
import * as vscode from 'vscode'
import { onDidChangeConfig } from './extension'
import * as juliaexepath from './juliaexepath'

let juliaPackagePath: string = null

let juliaDepotPath: string[] = null

export async function getPkgPath() {
    if (juliaPackagePath === null) {
        const jlexepath = await juliaexepath.getJuliaExePath()
        // TODO: there's got to be a better way to do this.
        const res = await exec(`"${jlexepath}" --startup-file=no --history-file=no -e "using Pkg;println(Pkg.depots()[1])"`)
        juliaPackagePath = join(res.stdout.trim(), 'dev')
    }
    return juliaPackagePath
}

export async function getPkgDepotPath() {
    if (juliaDepotPath === null) {
        const jlexepath = await juliaexepath.getJuliaExePath()
        const res = await exec(`"${jlexepath}" --startup-file=no --history-file=no -e "using Pkg; println.(Pkg.depots())"`)
        juliaDepotPath = res.stdout.trim().split('\n')
    }
    return juliaDepotPath
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        onDidChangeConfig(event => {
            if (event.affectsConfiguration('julia.executablePath')) {
                juliaPackagePath = null
            }
        })
    )
}
