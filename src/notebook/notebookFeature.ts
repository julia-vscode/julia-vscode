import * as vscode from 'vscode'
import { JuliaKernel } from './notebookKernel'

export class JuliaNotebookKernelProvider implements vscode.NotebookKernelProvider<JuliaKernel> {
    constructor(public extensionPath: string) {
    }

    // onDidChangeKernels?: vscode.Event<vscode.NotebookDocument>;

    async provideKernels(document: vscode.NotebookDocument, token: vscode.CancellationToken): Promise<JuliaKernel[]> {
        if (document.metadata.custom?.metadata?.kernelspec?.language === 'julia') {
            return [new JuliaKernel(document, this.extensionPath, true)]
        }
        else {
            return []
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
