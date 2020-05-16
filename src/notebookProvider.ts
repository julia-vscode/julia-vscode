/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import * as juliaexepath from './juliaexepath';
import * as readline from 'readline';
import { generatePipeName } from './utils';
import * as net from 'net';
import { uuid } from 'uuidv4';
import { getEnvPath } from './jlpkgenv';
import { TextEncoder } from 'util';
import { convertNotebookToHtml } from './notebookexport';
import { NotebookDocumentEditEvent } from 'vscode';
const { Subject } = require('await-notify');

function formatDuration(_duration: number): string {
	// const seconds = Math.floor(duration / 1000);
	// actual: ${String(duration - seconds).charAt(0)}

	const randomSeconds = Math.floor(Math.random() * 10);
	const randomTenths = Math.floor(Math.random() * 10);
	return `${randomSeconds}.${randomTenths}s`;
}

interface CellStreamOutput {
	output_type: 'stream';
	text: string;
}

interface CellErrorOutput {
	output_type: 'error';
	/**
	 * Exception Name
	 */
	ename: string;
	/**
	 * Exception Value
	 */
	evalue: string;
	/**
	 * Exception call stack
	 */
	traceback: string[];
}

interface CellDisplayOutput {
	output_type: 'display_data' | 'execute_result';
	data: { [key: string]: any };
}

export type RawCellOutput = CellStreamOutput | CellErrorOutput | CellDisplayOutput;

export interface RawCell {
	cell_type: 'markdown' | 'code';
	outputs?: RawCellOutput[];
	source: string;
	metadata: any;
	execution_count?: number;
}

function transformOutputToCore(rawOutput: RawCellOutput): vscode.CellOutput {
	if (rawOutput.output_type === 'execute_result' || rawOutput.output_type === 'display_data') {
		return {
			outputKind: vscode.CellOutputKind.Rich,
			data: rawOutput.data
		} as vscode.CellDisplayOutput;
	} else if (rawOutput.output_type === 'stream') {
		return {
			outputKind: vscode.CellOutputKind.Text,
			text: rawOutput.text
		} as vscode.CellStreamOutput;
	} else {
		return {
			outputKind: vscode.CellOutputKind.Error,
			ename: (<CellErrorOutput>rawOutput).ename,
			evalue: (<CellErrorOutput>rawOutput).evalue,
			traceback: (<CellErrorOutput>rawOutput).traceback
		} as vscode.CellErrorOutput;
	}
}

interface ExecutionRequest {
	id: number,
	cell: vscode.NotebookCell,
	startTime: number
}

export class JuliaNotebook {
	private executionRequests: Map<number, ExecutionRequest> = new Map<number, ExecutionRequest>();
	private _terminal: vscode.Terminal;
	private _socket: net.Socket;
	private _current_request_id: number = 0;
	private displayOrders = [
		'application/vnd.*',
		'application/json',
		'application/javascript',
		'text/html',
		'image/svg+xml',
		'text/markdown',
		'image/svg+xml',
		'image/png',
		'image/jpeg',
		'text/plain'
	];

	constructor(
		private _extensionPath: string,
		public notebookJSON: any,
	) {
	}

	resolve(): vscode.NotebookData {
		return {
			languages: ['julia'],
			metadata: {
				editable: true,
				cellEditable: true,
				cellRunnable: true,
				hasExecutionOrder: true,
				displayOrder: this.displayOrders
			},
			cells: this.notebookJSON.cells.map((raw_cell: RawCell) => {

				const executionOrder = typeof raw_cell.execution_count === 'number' ? raw_cell.execution_count : undefined;
				// if (typeof executionOrder === 'number') {
				// 	if (executionOrder >= this.nextExecutionOrder) {
				// 		this.nextExecutionOrder = executionOrder + 1;
				// 	}
				// }

				const cellEditable = raw_cell.metadata?.editable;
				const runnable = raw_cell.metadata?.runnable;
				const metadata = { editable: cellEditable, runnable: runnable, executionOrder };

				return {
					source: raw_cell.source ? raw_cell.source : '',
					language: 'julia',
					cellKind: raw_cell.cell_type === 'code' ? vscode.CellKind.Code : vscode.CellKind.Markdown,
					outputs: [],
					metadata
				}
			})
		}
	}

	async startKernel() {
		let connectedPromise = new Subject();
		let serverListeningPromise = new Subject();

		const pn = generatePipeName(uuid(), 'vscjl-nbk');

		let server = net.createServer(socket => {
			this._socket = socket;
			const rl = readline.createInterface(socket);

			rl.on('line', line => {
				let cmd_end = line.indexOf(":");
				let cmd = line.slice(undefined, cmd_end);
				let payload_encoded = line.slice(cmd_end + 1);
				let payload = Buffer.from(payload_encoded, 'base64').toString();

				if (cmd == 'image/png' || cmd == 'image/jpeg') {
					let parts = payload.split(';');

					let requestId = parseInt(parts[0]);
					let outputData = parts[1];

					let executionRequest = this.executionRequests.get(requestId);

					if (executionRequest) {
						let cell = executionRequest.cell;

						let raw_cell = {
							'output_type': 'execute_result',
							'data': {}
						};

						// raw_cell.data[cmd] = [outputData];
						raw_cell.data[cmd] = outputData.split('\n');

						let asdf = transformOutputToCore(<any>raw_cell);

						cell.outputs = cell.outputs.concat([asdf]);
					}
				}
				else if (cmd == 'image/svg+xml' || cmd == 'text/html' || cmd == 'text/plain' || cmd == 'text/markdown'|| cmd == 'application/vnd.vegalite.v4+json') {
					let parts = payload.split(';');

					let requestId = parseInt(parts[0]);
					let outputData = Buffer.from(parts[1], 'base64').toString();

					let executionRequest = this.executionRequests.get(requestId);

					if (executionRequest) {
						let cell = executionRequest.cell;

						let raw_cell = {
							'output_type': 'execute_result',
							'data': {}
						};

						raw_cell.data[cmd] = outputData.split('\n');

						let asdf = transformOutputToCore(<any>raw_cell);

						cell.outputs = cell.outputs.concat([asdf]);
					}
				}
				else if(cmd == 'stdout') {
					let parts = payload.split(';');

					let requestId = parseInt(parts[0]);
					let outputData = parts[1];

					let executionRequest = this.executionRequests.get(requestId);

					if (executionRequest) {
						let cell = executionRequest.cell;
						let raw_cell = {
							'output_type': 'stream',
							'text': outputData
						};

						cell.outputs = cell.outputs.concat([transformOutputToCore(<any>raw_cell)]);
					}
				}
				else if(cmd == 'status/finished') {
					const requestId = parseInt(payload);

					let executionRequest = this.executionRequests.get(requestId);

					if (executionRequest) {
						let cell = executionRequest.cell;

						cell.metadata.statusMessage = formatDuration(Date.now() - executionRequest.startTime);
						cell.metadata.runState = vscode.NotebookCellRunState.Success;
					}					
				}
				else if(cmd == 'status/errored') {
					const requestId = parseInt(payload);

					let executionRequest = this.executionRequests.get(requestId);

					if (executionRequest) {
						let cell = executionRequest.cell;

						cell.metadata.statusMessage = formatDuration(Date.now() - executionRequest.startTime);
						cell.metadata.runState = vscode.NotebookCellRunState.Error;
					}					
				}

			});

			connectedPromise.notify();
		});

		server.listen(pn, () => {
			serverListeningPromise.notify();
		});

		await serverListeningPromise.wait();

		const jlexepath = await juliaexepath.getJuliaExePath();
		let pkgenvpath = await getEnvPath();

		this._terminal = vscode.window.createTerminal({
			name: "Julia Notebook Kernel",
			shellPath: jlexepath,
			shellArgs: [
				'--color=yes',
				`--project=${pkgenvpath}`,
				'--startup-file=no',
				'--history-file=no',
				path.join(this._extensionPath, 'scripts', 'notebook', 'notebook.jl'),
				pn
			]
		});
		this._terminal.show(false);
		let asdf: Array<vscode.Disposable> = [];
		vscode.window.onDidCloseTerminal((terminal) => {
			if (terminal == this._terminal) {
				asdf[0].dispose();
				this._terminal = undefined;
				this._socket = undefined;
			}
		}, this, asdf);

		await connectedPromise.wait();
	}

	async execute(document: vscode.NotebookDocument, cell: vscode.NotebookCell | undefined) {
		if (!cell) {
			// run them all
			for (let cell of document.cells) {
				if (cell.cellKind === vscode.CellKind.Code) {
					await this.execute(document, cell);
				}
			}
			return;
		}

		if (!this._terminal) {
			await this.startKernel()	
		}		

		if (cell) {
			cell.metadata.statusMessage = '*';
			cell.metadata.runState = vscode.NotebookCellRunState.Running;

			let encoded_code = Buffer.from(cell.source).toString('base64');
			this._socket.write(`${this._current_request_id}:${encoded_code}\n`);
			this.executionRequests.set(this._current_request_id, {id: this._current_request_id, cell: cell, startTime: Date.now()});
			cell.metadata.executionOrder = this._current_request_id;
			this._current_request_id += 1;

			cell.outputs = [];
			
		} else {
			throw(new Error('This should not happen.'))
		}
	}

	containHTML(rawCell: any) {
		return rawCell.outputs && rawCell.outputs.some((output: any) => {
			if (output.output_type === 'display_data' && output.data['text/html']) {
				return true;
			}

			return false;
		});
	}
}

export class JuliaNotebookProvider implements vscode.NotebookContentProvider {
	private _onDidChangeNotebook = new vscode.EventEmitter<NotebookDocumentEditEvent>();
	onDidChangeNotebook: vscode.Event<NotebookDocumentEditEvent> = this._onDidChangeNotebook.event;
	private _notebooks: Map<string, JuliaNotebook> = new Map();
	onDidChange: vscode.Event<NotebookDocumentEditEvent> = new vscode.EventEmitter<NotebookDocumentEditEvent>().event;

	constructor(private _extensionPath: string) {
	}

	async openNotebook(uri: vscode.Uri): Promise<vscode.NotebookData> {
		try {
			let content_raw = await vscode.workspace.fs.readFile(uri);

			let content = content_raw.toString();

			let lines = content.split(/\r?\n/);

			let json: {cells: RawCell[]} = {cells: []};

			let currentLineIndex = 0;
			let processedUpTo = 0;
			while (currentLineIndex < lines.length) {
				let currentLine = lines[currentLineIndex];

				if(currentLine.trimRight()=='```{julia}') {
					if(currentLineIndex>processedUpTo) {
						const newMDCell = lines.slice(processedUpTo,currentLineIndex).join('\n');

						json.cells.push({cell_type: 'markdown', source: newMDCell, metadata: undefined})
					}

					currentLineIndex++;

					const codeStartLineIndex = currentLineIndex;

					while(currentLineIndex<lines.length) {
						let currentLine = lines[currentLineIndex];

						if (currentLine.trimRight()=='```') {
							const codeEndLineIndex = currentLineIndex;

							const newCodeCell = lines.slice(codeStartLineIndex, codeEndLineIndex).join('\n');

							json.cells.push({cell_type: 'code', source: newCodeCell, outputs: [], metadata: undefined})

							currentLineIndex++
							break;
						}
						else {
							currentLineIndex++;

							// This amounts to a final code cell that is not closed
							if(currentLineIndex==lines.length) {
								const codeEndLineIndex = currentLineIndex;
								const newCodeCell = lines.slice(codeStartLineIndex, codeEndLineIndex).join('\n');
								json.cells.push({cell_type: 'code', source: newCodeCell, outputs: [], metadata: undefined})
							}
						}
					}

					processedUpTo = currentLineIndex;
				}
				else {
					currentLineIndex++;
				}				
			}

			if(processedUpTo<lines.length) {
				const newMDCell = lines.slice(processedUpTo).join('\n');

				json.cells.push({cell_type: 'markdown', source: newMDCell, metadata: undefined})
			}

			let juliaNotebook = new JuliaNotebook(this._extensionPath, json);
			this._notebooks.set(uri.toString(), juliaNotebook);
			
			return juliaNotebook.resolve();
		} catch {
			throw new Error('Fail to load the document');
		}
	}

	async saveNotebook(document: vscode.NotebookDocument, token: vscode.CancellationToken): Promise<void> {
		return this._save(document, document.uri, token);
	}

	saveNotebookAs(targetResource: vscode.Uri, document: vscode.NotebookDocument, token: vscode.CancellationToken): Promise<void> {
		return this._save(document, targetResource, token);
	}

	async _save(document: vscode.NotebookDocument, targetResource: vscode.Uri, _token: vscode.CancellationToken): Promise<void> {

		let content = document.cells.map(cell=>{
			if(cell.cellKind==vscode.CellKind.Markdown) {
				return cell.source;
			}
			else {
				return '```{julia}\n' + cell.source + '\n```';
			}
		}).join('\n');

		await vscode.workspace.fs.writeFile(targetResource, new TextEncoder().encode(content));

		const html_content = convertNotebookToHtml(document, content);

		await vscode.workspace.fs.writeFile(vscode.Uri.parse(targetResource.toString() + '.html'), new TextEncoder().encode(html_content));

		return;
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

	async executeCell(document: vscode.NotebookDocument, cell: vscode.NotebookCell | undefined, token: vscode.CancellationToken): Promise<void> {
		const jupyterNotebook = this._notebooks.get(document.uri.toString());
		if (jupyterNotebook) {
			return jupyterNotebook.execute(document, cell);
		}
	}
	
}