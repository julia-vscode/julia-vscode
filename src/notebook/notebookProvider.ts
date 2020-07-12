/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TextEncoder } from 'util'
import * as vscode from 'vscode'
import { NotebookDocumentEditEvent } from 'vscode'
import { JuliaNotebook, RawCellOutput } from './nbJuliaNotebook'
import { convertNotebookToHtml } from './notebookexport'

export interface RawCell {
    cell_type: 'markdown' | 'code';
    outputs?: RawCellOutput[];
    source: string;
    metadata: any;
    execution_count?: number;
}

export class JuliaNotebookProvider implements vscode.NotebookContentProvider, vscode.NotebookKernel {
    private _localDisposables: vscode.Disposable[] = []

    private _notebooks: Map<string, JuliaNotebook> = new Map()


    public label = 'Julia Kernel'
    public kernel = this

    onDidChangeNotebook: vscode.Event<NotebookDocumentEditEvent> = new vscode.EventEmitter<NotebookDocumentEditEvent>().event;

    constructor(extensionPath: string) {
        this._localDisposables.push(
            vscode.notebook.onDidOpenNotebookDocument(document => {
                const docKey = document.uri.toString()
                if (!this._notebooks.has(docKey)) {
                    const notebook = new JuliaNotebook(extensionPath)
                    this._notebooks.set(docKey, notebook)
                    // this.register(
                    //     docKey,
                    //     project,
                    //     key => document.cells.some(cell => cell.uri.toString() === key) || (key === docKey),
                    // )
                }
            }),

            vscode.notebook.onDidCloseNotebookDocument(document => {
                const docKey = document.uri.toString()
                if (this._notebooks.has(docKey)) {
                    // const notebook = this._notebooks.get(docKey)
                    this._notebooks.delete(docKey)
                    // TODO Reenable
                    // notebook.dispose()
                }
            }),
        )
    }

    public dispose() {
        this._localDisposables.forEach(d => d.dispose())
    }

    async openNotebook(uri: vscode.Uri): Promise<vscode.NotebookData> {
        try {
            const content_raw = await vscode.workspace.fs.readFile(uri)

            const content = content_raw.toString()

            const lines = content.split(/\r?\n/)

            const json: { cells: RawCell[] } = { cells: [] }

            let currentLineIndex = 0
            let processedUpTo = 0
            while (currentLineIndex < lines.length) {
                const currentLine = lines[currentLineIndex]

                if (currentLine.trimRight() === '```{julia}') {
                    if (currentLineIndex > processedUpTo) {
                        const newMDCell = lines.slice(processedUpTo, currentLineIndex).join('\n')

                        json.cells.push({ cell_type: 'markdown', source: newMDCell, metadata: undefined })
                    }

                    currentLineIndex++

                    const codeStartLineIndex = currentLineIndex

                    while (currentLineIndex < lines.length) {
                        const currentLine = lines[currentLineIndex]

                        if (currentLine.trimRight() === '```') {
                            const codeEndLineIndex = currentLineIndex

                            const newCodeCell = lines.slice(codeStartLineIndex, codeEndLineIndex).join('\n')

                            json.cells.push({ cell_type: 'code', source: newCodeCell, outputs: [], metadata: undefined })

                            currentLineIndex++
                            break
                        }
                        else {
                            currentLineIndex++

                            // This amounts to a final code cell that is not closed
                            if (currentLineIndex === lines.length) {
                                const codeEndLineIndex = currentLineIndex
                                const newCodeCell = lines.slice(codeStartLineIndex, codeEndLineIndex).join('\n')
                                json.cells.push({ cell_type: 'code', source: newCodeCell, outputs: [], metadata: undefined })
                            }
                        }
                    }

                    processedUpTo = currentLineIndex
                }
                else {
                    currentLineIndex++
                }
            }

            if (processedUpTo < lines.length) {
                const newMDCell = lines.slice(processedUpTo).join('\n')

                json.cells.push({ cell_type: 'markdown', source: newMDCell, metadata: undefined })
            }

            return {
                languages: ['julia'],
                metadata: {
                    // displayOrder: this.displayOrders
                },
                cells: json.cells.map((raw_cell: RawCell) => {

                    // const executionOrder = typeof raw_cell.execution_count === 'number' ? raw_cell.execution_count : undefined
                    // if (typeof executionOrder === 'number') {
                    // 	if (executionOrder >= this.nextExecutionOrder) {
                    // 		this.nextExecutionOrder = executionOrder + 1;
                    // 	}
                    // }

                    // const cellEditable = raw_cell.metadata?.editable
                    // const runnable = raw_cell.metadata?.runnable
                    // const metadata = { editable: cellEditable, runnable: runnable, executionOrder }

                    return {
                        source: raw_cell.source ? raw_cell.source : '',
                        language: 'julia',
                        cellKind: raw_cell.cell_type === 'code' ? vscode.CellKind.Code : vscode.CellKind.Markdown,
                        outputs: [],
                        metadata: {
                            editable: true,
                            runnable: true,
                            breakpointMargin: true
                        }
                    }
                })
            }
        } catch {
            throw new Error('Fail to load the document')
        }
    }

    async saveNotebook(document: vscode.NotebookDocument, token: vscode.CancellationToken): Promise<void> {
        return this._save(document, document.uri)
    }

    async saveNotebookAs(targetResource: vscode.Uri, document: vscode.NotebookDocument, token: vscode.CancellationToken): Promise<void> {
        return this._save(document, targetResource)
    }

    async _save(document: vscode.NotebookDocument, targetResource: vscode.Uri): Promise<void> {

        const content = document.cells.map(cell => {
            if (cell.cellKind === vscode.CellKind.Markdown) {
                return cell.document.getText()
            }
            else {
                return '```{julia}\n' + cell.document.getText() + '\n```'
            }
        }).join('\n')

        await vscode.workspace.fs.writeFile(targetResource, new TextEncoder().encode(content))

        const html_content = convertNotebookToHtml(document, content)

        await vscode.workspace.fs.writeFile(vscode.Uri.parse(targetResource.toString() + '.html'), new TextEncoder().encode(html_content))

        return
        // let cells: RawCell[] = [];

        // for (let i = 0; i < document.cells.length; i++) {
        // 	let lines = document.cells[i].source.split(/\r|\n|\r\n/g);
        // 	let source = lines.map((value, index) => {
        // 		if (index !== lines.length - 1) {
        // 			return value + '\n';
        // 		} else {
        // 			return value;
        // 		}
        // 	});

        // 	if (document.cells[i].cellKind === vscode.CellKind.Markdown) {
        // 		cells.push({
        // 			source: source,
        // 			metadata: {
        // 				language_info: {
        // 					name: document.cells[i].language || 'markdown'
        // 				}
        // 			},
        // 			cell_type: document.cells[i].cellKind === vscode.CellKind.Markdown ? 'markdown' : 'code'
        // 		});
        // 	} else {
        // 		cells.push({
        // 			source: source,
        // 			metadata: {
        // 				language_info: {
        // 					name: document.cells[i].language || 'markdown'
        // 				}
        // 			},
        // 			cell_type: document.cells[i].cellKind === vscode.CellKind.Markdown ? 'markdown' : 'code',
        // 			outputs: document.cells[i].outputs.map(output => transformOutputFromCore(output)),
        // 			execution_count: document.cells[i].metadata?.executionOrder
        // 		});
        // 	}
        // }

        // let raw = this._notebooks.get(document.uri.toString());

        // if (raw) {
        // 	raw.notebookJSON.cells = cells;
        // 	let content = JSON.stringify(raw.notebookJSON, null, 4);
        // 	await vscode.workspace.fs.writeFile(targetResource, new TextEncoder().encode(content));
        // } else {
        // 	let content = JSON.stringify({ cells: cells }, null, 4);
        // 	await vscode.workspace.fs.writeFile(targetResource, new TextEncoder().encode(content));
        // }

        // return;
    }

    async resolveNotebook(_document: vscode.NotebookDocument, _webview: vscode.NotebookCommunication): Promise<void> {
        // nothing
    }

    async backupNotebook(): Promise<vscode.NotebookDocumentBackup> { return { id: '', delete: () => { } } }

    async executeCell(document: vscode.NotebookDocument, cell: vscode.NotebookCell, token: vscode.CancellationToken): Promise<void> {
        const notebook = this._notebooks.get(document.uri.toString())
        if (notebook) {
            await notebook.eval(cell)
        }
    }

    async executeAllCells(document: vscode.NotebookDocument, token: vscode.CancellationToken): Promise<void> {
        for (const cell of document.cells) {
            if (token.isCancellationRequested) {
                break
            }
            await this.executeCell(document, cell, token)
        }
    }

}
