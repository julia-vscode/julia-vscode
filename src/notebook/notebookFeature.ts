/* eslint-disable semi */
import * as semver from 'semver';
import * as vscode from 'vscode';
import { WorkspaceFeature } from '../interactive/workspace';
import { JuliaExecutable, JuliaExecutablesFeature } from '../juliaexepath';
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
    private readonly _controllers = new Map<vscode.NotebookController, JuliaExecutable>();
    private readonly kernels: Map<vscode.NotebookDocument, JuliaKernel> = new Map<vscode.NotebookDocument, JuliaKernel>()
    private _outputChannel: vscode.OutputChannel
    private readonly disposables: vscode.Disposable[] = [];

    constructor(private context: vscode.ExtensionContext, private juliaExecutableFeature: JuliaExecutablesFeature, private workspaceFeature: WorkspaceFeature) {
        const section = vscode.workspace.getConfiguration('julia')

        this.init()

        vscode.workspace.onDidOpenNotebookDocument(this.onDidOpenNotebookDocument, this, this.disposables)
    }

    private async init() {
        this._outputChannel = vscode.window.createOutputChannel('Julia Notebook Kernels')

        const juliaVersions = await this.juliaExecutableFeature.getJuliaExePathsAsync()

        for (const juliaVersion of juliaVersions) {
            const ver = juliaVersion.getVersion()
            const kernelId = `julia-vscode-${ver.major}.${ver.minor}.${ver.patch}`
            const displayName = `Julia ${ver}`;

            const controller = vscode.notebooks.createNotebookController(kernelId, JupyterNotebookViewType, displayName)
            controller.supportedLanguages = ['julia']
            controller.supportsExecutionOrder = true
            controller.description = 'Julia VS Code extension'
            controller.detail = juliaVersion.getCommand()
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
                this.updateNotebookWithSelectedKernel(notebook, ver);
            }, this, this.disposables)

            this._controllers.set(controller, juliaVersion)
        }
    }

    private onDidOpenNotebookDocument(e: vscode.NotebookDocument) {
        if (!this.isJuliaNotebook(e) || this._controllers.size === 0) {
            return
        }
        // Get metadata from notebook (to get an hint of what version of julia is used)
        const version = this.getNotebookLanguageVersion(e)

        // Find all controllers where the Julia version matches the Julia version in the
        // notebook exactly. If there are multiple controllers, put official release first,
        // and prefer x64 builds
        const perfectMatchVersions = Array.from(this._controllers.entries()).
            filter(([_, juliaExec]) => juliaExec.getVersion() === semver.parse(version)).
            sort(([_, a], [__, b]) => {
                if (a.officialChannel !== b.officialChannel) {
                    // First, we give preference to official releases, rather than linked juliaup channels
                    return a.officialChannel ? -1 : 1
                }
                else if (a.arch !== b.arch) {
                    // Next we give preference to x64 builds
                    if (a.arch === 'x64') {
                        return -1
                    }
                    else if (b.arch === 'x64') {
                        return 1
                    }
                    else {
                        return 0
                    }
                }
                else {
                    return 0
                }
            }
            )

        if (perfectMatchVersions.length > 0) {
            const [controller, _] = perfectMatchVersions[0]

            controller.updateNotebookAffinity(e, vscode.NotebookControllerAffinity.Preferred)
        }
        else {
            // Find all controllers where the major and minor version match. Put newer patch versions first,
            // and then have the same preference ordering that we had above
            const minorMatchVersions = Array.from(this._controllers.entries()).filter(([_, juliaExec]) => {
                const v1 = juliaExec.getVersion()
                const v2 = semver.parse(version)
                return v1.major === v2.major && v1.minor === v2.minor
            }).sort(([_, a], [__, b]) => {
                const aVer = a.getVersion()
                const bVer = b.getVersion()
                if (aVer.patch !== bVer.patch) {
                    return b.getVersion().patch - a.getVersion().patch
                }
                else if (a.officialChannel !== b.officialChannel) {
                    // First, we give preference to official releases, rather than linked juliaup channels
                    return a.officialChannel ? -1 : 1
                }
                else if (a.arch !== b.arch) {
                    // Next we give preference to x64 builds
                    if (a.arch === 'x64') {
                        return -1
                    }
                    else if (b.arch === 'x64') {
                        return 1
                    }
                    else {
                        return 0
                    }
                }
                else {
                    return 0
                }
            })

            if (minorMatchVersions.length > 0) {
                const [controller, _] = minorMatchVersions[0]

                controller.updateNotebookAffinity(e, vscode.NotebookControllerAffinity.Preferred)
            }
        }
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
                const kernel = new JuliaKernel(this.context.extensionPath, controller, notebook, this._controllers.get(controller), this._outputChannel, this)
                await this.workspaceFeature.addNotebookKernel(kernel)
                this.kernels.set(notebook, kernel)

                kernel.onStopped(e => {
                    if (this.kernels.get(kernel.notebook) === kernel) {
                        this.kernels.delete(kernel.notebook)
                    }
                })
            }
        }

        const currentKernel = this.kernels.get(notebook)

        for (const cell of cells) {
            await currentKernel.queueCell(cell)
        }
    }

    private getNotebookLanguageVersion(notebook: vscode.NotebookDocument): string {
        const metadata = (notebook.metadata as JupyterNotebookMetadata)?.custom.metadata
        const version = metadata?.language_info?.version || ''
        return this.isJuliaNotebook(notebook) ? version : ''
    }

    private updateNotebookWithSelectedKernel(notebook: vscode.NotebookDocument, version: semver.SemVer) {
        // Dont edit in place, create a copy of the metadata.
        const nbmetadata: JupyterNotebookMetadata = JSON.parse(JSON.stringify((notebook.metadata || { custom: { metadata: {} } })));
        nbmetadata.custom.metadata.kernelspec = {
            display_name: `Julia ${version}`,
            language: 'julia',
            name: `julia-${version.major}.${version.minor}`
        }
        nbmetadata.custom.metadata.language_info = {
            name: 'julia',
            version: `${version}`,
            mimetype: 'application/julia',
            file_extension: '.jl'
        }

        const edit = new vscode.WorkspaceEdit()
        edit.replaceNotebookMetadata(notebook.uri, nbmetadata)
        vscode.workspace.applyEdit(edit)
    }

    private isJuliaNotebook(notebook: vscode.NotebookDocument) {
        if (notebook.notebookType !== JupyterNotebookViewType) {
            return false;
        }

        return (notebook.metadata as JupyterNotebookMetadata)?.custom.metadata?.language_info?.name?.toLocaleLowerCase() === 'julia'
    }

    public async restart(kernel: JuliaKernel) {
        const newKernel = new JuliaKernel(this.context.extensionPath, kernel.controller, kernel.notebook, kernel.juliaExecutable, this._outputChannel, this)
        newKernel.onStopped(e => {
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
        this._controllers.forEach((_, i) => i.dispose())
        this._outputChannel.dispose()
    }
}
