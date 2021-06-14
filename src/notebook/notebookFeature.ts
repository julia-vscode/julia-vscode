import * as vscode from 'vscode';
import { JuliaKernel } from './notebookKernel';

export class JuliaNotebookFeature {
    private readonly kernel: JuliaKernel;
    constructor(context: vscode.ExtensionContext) {
        this.kernel = new JuliaKernel(context.extensionPath)
    }

    public dispose() {
        this.kernel.dispose()
    }
}
