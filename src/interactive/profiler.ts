import { uuid } from 'uuidv4'
import * as vscode from 'vscode'

const g_profilerResults = new Map<string, string>()

export class ProfilerResultsProvider implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri) {
        return g_profilerResults.get(uri.toString())
    }
}

export function addProfilerResult(uri: vscode.Uri, content: string) {
    g_profilerResults.set(uri.toString(), content)
}

export async function showProfileResult(content: string) {
    const new_uuid = uuid()
    const uri = vscode.Uri.parse('juliavsodeprofilerresults:' + new_uuid.toString() + '.cpuprofile')
    addProfilerResult(uri, content)
    const doc = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(doc, { preview: false })
}

export async function showProfileResultFile(file: string) {
    const uri = vscode.Uri.file(file)
    await vscode.commands.executeCommand('vscode.open', uri, {
        preserveFocuse: true,
        preview: false,
        viewColumn: vscode.ViewColumn.Beside
    })
}
