import * as vscode from 'vscode'
import { JuliaNotebookProvider } from './notebookProvider'

export class JuliaNotebookFeature {
    public provider: JuliaNotebookProvider;

    constructor(context: vscode.ExtensionContext) {
        this.provider = new JuliaNotebookProvider(context.extensionPath)

        context.subscriptions.push(
            vscode.notebook.registerNotebookContentProvider('julianotebook', this.provider),
            vscode.commands.registerCommand('language-julia.toggleDebugging', async () => {
                if (vscode.window.activeNotebookEditor) {
                    const { document } = vscode.window.activeNotebookEditor
                    const notebook = this.provider._notebooks.get(document.uri.toString())
                    if (notebook) {
                        await notebook.toggleDebugging(document)
                    }
                }
            })
        )
    }

    public dispose() {}
}
