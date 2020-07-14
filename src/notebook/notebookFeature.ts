import * as vscode from 'vscode'
import { JuliaNotebookProvider } from './notebookProvider'
import { VegaRenderer } from './notebookVegaRenderer'

export class JuliaNotebookFeature {
    public provider: JuliaNotebookProvider;

    constructor(context: vscode.ExtensionContext) {
        this.provider = new JuliaNotebookProvider(context.extensionPath)

        context.subscriptions.push(
            vscode.notebook.registerNotebookContentProvider('julianotebook', this.provider),
            vscode.notebook.registerNotebookOutputRenderer(
                'juliavega',
                { mimeTypes: ['application/vnd.vegalite.v4+json'] },
                new VegaRenderer(context.extensionPath)),
            vscode.commands.registerCommand('language-julia.toggleDebugging', async () => {
                if (vscode.notebook.activeNotebookEditor) {
                    const { document } = vscode.notebook.activeNotebookEditor
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
