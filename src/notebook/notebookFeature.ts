/* eslint-disable semi */
import * as semver from 'semver';
import * as vscode from 'vscode';
import { WorkspaceFeature } from '../interactive/workspace';
import { getJuliaExePaths, JuliaExecutable } from '../juliaexepath';
import { JuliaKernel } from './notebookKernel';

const JupyterNotebookViewType = 'jupyter-notebook';
type JupyterNotebookMetadata = Partial<{
    custom: {
        metadata: {
            kernelspec: {
                display_name: string;
                language: string;
                name: string;
            },
            language_info: {
                name: string;
                version: string;
                mimetype: string;
                file_extension: string;
            }
        }
    }
}>

export class JuliaNotebookFeature {
    private readonly _controllers: vscode.NotebookController[] = []
    private readonly _juliaVersions = new Map<string, JuliaExecutable>()
    private readonly kernels: Map<vscode.NotebookDocument, JuliaKernel> = new Map<vscode.NotebookDocument, JuliaKernel>()
    private _outputChannel: vscode.OutputChannel
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private context: vscode.ExtensionContext, private workspaceFeature: WorkspaceFeature) {
        this.init()
        vscode.workspace.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposables)
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
            const displayName = `Julia ${ver} Kernel`;
            const controller = vscode.notebooks.createNotebookController(kernelId, JupyterNotebookViewType, displayName)
            controller.supportedLanguages = ['julia']
            controller.supportsExecutionOrder = true
            controller.onDidChangeSelectedNotebooks((e) => {
                if (e.selected && e.notebook) {
                    e.notebook.getCells().filter(cell => cell.kind === vscode.NotebookCellKind.Code).map(cell => vscode.languages.setTextDocumentLanguage(cell.document, 'julia'))
                }
            })
            controller.executeHandler = this.executeCells.bind(this)
            controller.onDidChangeSelectedNotebooks(({ notebook, selected }) => {
                // If we select our controller, then update the notebook metadata with the kernel information.
                if (!selected) {
                    return;
                }
                this.updateNotebookWithSelectedKernel(notebook, displayName, ver);
            }, this, this.disposables)

            this._controllers.push(controller)
        }
    }

    private onDidOpenNotebookDocument(e: vscode.NotebookDocument) {
        if (!this.isJuliaNotebook(e) || this._controllers.length === 0) {
            return;
        }
        // Get metadata from notebook (to get an hint of what version of julia is used)
        const name = this.getKernelSpecName(e);
        this._controllers.forEach(controller => {
            // If we find a controller that matches the vesion in the notebook metadata, then set
            // that controller as the preferred controller.
            if (name === controller.id) {
                controller.updateNotebookAffinity(e, vscode.NotebookControllerAffinity.Preferred)
            }
        })
    }
    private async executeCells(cells: vscode.NotebookCell[], notebook: vscode.NotebookDocument, controller: vscode.NotebookController): Promise<void> {
        // First check whether we already have a kernel running for the current notebook document
        if (!this.kernels.has(notebook)) {

            // Check whether there is still a running kernel for a closed notebook with the same Uri
            let foundExistingKernel = false
            for (const [k, v] of this.kernels) {
                if (k.isClosed && (k.uri.toString() === notebook.uri.toString())) {
                    foundExistingKernel = true
                    v.notebook = notebook

                    this.kernels.delete(k)

                    this.kernels.set(notebook, v)

                    break
                }
            }

            if (!foundExistingKernel) {
                const kernel = new JuliaKernel(this.context.extensionPath, controller, notebook, this._juliaVersions.get(controller.id), this._outputChannel, this)
                await this.workspaceFeature.addNotebookKernel(kernel)
                this.kernels.set(notebook, kernel)

                kernel.onStopped(e => {
                    this.kernels.delete(kernel.notebook)
                })
            }
        }

        const currentKernel = this.kernels.get(notebook)

        for (const cell of cells) {
            await currentKernel.queueCell(cell)
        }
    }
    private getKernelSpecName(notebook: vscode.NotebookDocument): string {
        const metadata = (notebook.metadata as JupyterNotebookMetadata)?.custom.metadata;
        const kernelspecName = metadata?.kernelspec?.name || '';
        return this.isJuliaNotebook(notebook) ? kernelspecName : ''
    }
    private updateNotebookWithSelectedKernel(notebook: vscode.NotebookDocument, name: string, version: string) {
        // Dont edit in place, create a copy of the metadata.
        const nbmetadata: JupyterNotebookMetadata = JSON.parse(JSON.stringify((notebook.metadata || { custom: { metadata: {} } })));
        nbmetadata.custom.metadata.kernelspec = {
            display_name: name,
            language: 'julia',
            name: name
        }
        nbmetadata.custom.metadata.language_info = {
            name: name,
            version: version,
            mimetype: 'text/julia',
            file_extension: '.jl'
        }
        // TODO: Update the notebook metadata (when its stable).
    }
    private isJuliaNotebook(notebook: vscode.NotebookDocument) {
        if (notebook.notebookType !== JupyterNotebookViewType) {
            return false;
        }
        const metadata = (notebook.metadata as JupyterNotebookMetadata)?.custom.metadata;
        if (!metadata.kernelspec && metadata.language_info) {
            return false;
        }
        return metadata?.kernelspec?.language?.toLowerCase() === 'julia' || metadata?.language_info?.name?.toLocaleLowerCase() === 'julia';
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
        this.disposables.forEach(i => i.dispose())
        this._controllers.forEach(i => i.dispose())
        this._outputChannel.dispose()
    }
}
