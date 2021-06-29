/* eslint-disable semi */
import * as semver from 'semver';
import * as vscode from 'vscode';
import { WorkspaceFeature } from '../interactive/workspace';
import { getJuliaExePaths, JuliaExecutable } from '../juliaexepath';
import { JuliaKernel } from './notebookKernel';

export class JuliaNotebookFeature {
    private readonly _controllers: vscode.NotebookController[] = []
    private readonly _juliaVersions = new Map<string, JuliaExecutable>()
    private readonly kernels: Map<vscode.NotebookDocument, JuliaKernel> = new Map<vscode.NotebookDocument, JuliaKernel>()
    private _outputChannel: vscode.OutputChannel

    constructor(private context: vscode.ExtensionContext, private workspaceFeature: WorkspaceFeature) {
        this.init()
    }

    private async init() {
        this._outputChannel = vscode.window.createOutputChannel('Julia Notebook Kernels')

        const juliaVersions = await getJuliaExePaths()

        // Find the highest installed version per minor version
        for (const i of juliaVersions) {
            const ver = i.getVersion()

            const kernelId = `julia-${semver.major(ver)}.${semver.minor(ver)}`

            if (this._juliaVersions.has(kernelId)) {
                if (semver.gt(i.getVersion(), this._juliaVersions.get(kernelId).getVersion())) {
                    this._juliaVersions.set(kernelId, i)
                }
            }
            else {
                this._juliaVersions.set(kernelId, i)
            }
        }

        // Add one controller per Julia minor version that we found
        for (const [kernelId, juliaVersion] of this._juliaVersions) {
            const ver = juliaVersion.getVersion()

            const controller = vscode.notebooks.createNotebookController(kernelId, 'jupyter-notebook', `Julia ${ver} Kernel`)
            controller.supportedLanguages = ['julia']
            controller.supportsExecutionOrder = true
            controller.onDidChangeSelectedNotebooks((e) => {
                if (e.selected && e.notebook) {
                    e.notebook.getCells().filter(cell => cell.kind === vscode.NotebookCellKind.Code).map(cell => vscode.languages.setTextDocumentLanguage(cell.document, 'julia'))
                }
            })
            controller.executeHandler = this.executeCells.bind(this)

            this._controllers.push(controller)
        }
    }

    private async executeCells(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument, controller: vscode.NotebookController): Promise<void> {
        // First check whether we already have a kernel running for the current notebook document
        if (!this.kernels.has(notebook)) {
            const kernel = new JuliaKernel(this.context.extensionPath, controller, notebook, this._juliaVersions.get(controller.id), this._outputChannel, this)
            await this.workspaceFeature.addNotebookKernel(kernel)
            this.kernels.set(notebook, kernel)

            kernel.onStopped(e => {
                if (this.kernels.get(notebook) === kernel) {
                    this.kernels.delete(notebook)
                }
            })
        }

        const currentKernel = this.kernels.get(notebook)

        for (const cell of cells) {
            await currentKernel.queueCell(cell)
        }
    }

    public async restart(kernel: JuliaKernel) {
        const newKernel = new JuliaKernel(this.context.extensionPath, kernel.controller, kernel.notebook, kernel.juliaExecutable, this._outputChannel, this)
        kernel.onStopped(e => {
            if (this.kernels.get(newKernel.notebook) === newKernel) {
                this.kernels.delete(newKernel.notebook)
            }
        })

        await kernel.stop()

        await this.workspaceFeature.addNotebookKernel(newKernel)
        this.kernels.set(kernel.notebook, newKernel)
    }

    public dispose() {
        this.kernels.forEach(i => i.dispose())
        this._controllers.forEach(i => i.dispose())
        this._outputChannel.dispose()
    }
}
