import * as vscode from 'vscode'
import { getJuliaExePaths } from '../juliaexepath'
import { JuliaKernel } from './notebookKernel'

export class JuliaNotebookKernelProvider implements vscode.NotebookKernelProvider<JuliaKernel> {
    constructor(public extensionPath: string) {
    }

    // onDidChangeKernels?: vscode.Event<vscode.NotebookDocument>;

    async provideKernels(document: vscode.NotebookDocument, token: vscode.CancellationToken): Promise<JuliaKernel[]> {
        if (document.viewType === 'jupyter-notebook') {
            const juliaExecutables = await getJuliaExePaths()
            return juliaExecutables.map(executable => new JuliaKernel(document, this.extensionPath, true, executable.version, executable.path))
        }
    }

    async resolveKernel?(kernel: JuliaKernel, document: vscode.NotebookDocument, webview: vscode.NotebookCommunication, token: vscode.CancellationToken): Promise<void> {

    }

}

export class JuliaNotebookFeature {
    public provider: JuliaNotebookKernelProvider;

    constructor(context: vscode.ExtensionContext) {
        this.provider = new JuliaNotebookKernelProvider(context.extensionPath)

        // TODO what is the correct selector for us here?
        context.subscriptions.push(vscode.notebook.registerNotebookKernelProvider(
            {
                filenamePattern: '**/*.ipynb',
                viewType: 'jupyter-notebook'
            },
            this.provider
        )

        )
    }

    public dispose() {
    }
}
