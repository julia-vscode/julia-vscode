import * as vscode from 'vscode';
import { JuliaKernel } from './notebookKernel';

export class JuliaNotebookFeature {
    private readonly controller: vscode.NotebookController;
    private readonly kernels: Map<vscode.NotebookDocument, JuliaKernel> = new Map<vscode.NotebookDocument, JuliaKernel>()

    constructor(private context: vscode.ExtensionContext) {
        this.controller = vscode.notebooks.createNotebookController('julia', 'jupyter-notebook', 'Julia Kernel')
        this.controller.supportedLanguages = ['julia']
        this.controller.supportsExecutionOrder = true
        this.controller.onDidChangeSelectedNotebooks((e) =>{
            if (e.selected && e.notebook) {
                e.notebook.getCells().filter(cell => cell.kind === vscode.NotebookCellKind.Code).map(cell => vscode.languages.setTextDocumentLanguage(cell.document, 'julia'))
            }
        })
        this.controller.executeHandler = this.executeCells.bind(this)
    }

    private async executeCells(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument, controller: vscode.NotebookController): Promise<void> {
        // First check whether we already have a kernel running for the current notebook document
        if (!this.kernels.has(notebook)) {
            this.kernels.set(notebook, new JuliaKernel(this.context.extensionPath, this.controller, notebook))
        }

        const currentKernel = this.kernels.get(notebook)

        cells.forEach(async cell => await currentKernel.executeCell(cell))
    }

    public dispose() {
        // this.kernels.dispose()
    }
}
