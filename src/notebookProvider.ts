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
const { Subject } = require('await-notify');

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
	source: string[];
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

export class JuliaNotebook {
	private request_id_to_cell: Map<number, vscode.NotebookCell> = new Map<number, vscode.NotebookCell>();
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
		private editor: vscode.NotebookEditor
	) {
		editor.document.languages = ['julia'];
		editor.document.displayOrder = this.displayOrders;
		// editor.document.metadata = {
		// 	editable: notebookJSON?.metadata?.editable === undefined ? true : notebookJSON?.metadata?.editable,
		// 	cellEditable: notebookJSON?.metadata?.cellEditable === undefined ? true : notebookJSON?.metadata?.cellEditable,
		// 	cellRunnable: notebookJSON?.metadata?.cellRunnable === undefined ? true : notebookJSON?.metadata?.cellRunnable,
		// 	hasExecutionOrder: true
		// };		
	}

	async resolve(notebookJSON: {cells: RawCell[]}) {
		this.editor.edit(editBuilder => {
			notebookJSON.cells.forEach(raw_cell => {
				let outputs: vscode.CellOutput[] = [];

				const metadata = { editable: true, runnable: true, executionOrder: 0};

				editBuilder.insert(0,
					raw_cell.source ? raw_cell.source.join('') : '',
					'julia',
					raw_cell.cell_type === 'code' ? vscode.CellKind.Code :vscode.CellKind.Markdown,
					outputs,
					metadata);
			});
			

		});	
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
				let payload = line.slice(cmd_end + 1);

				if (cmd == 'image/png') {
					let parts = payload.split(';');

					let requestId = parseInt(parts[0]);
					let outputData = parts[1];

					let cell = this.request_id_to_cell.get(requestId);

					if (cell) {
						cell.outputs = cell.outputs.concat([transformOutputToCore({
							'output_type': 'execute_result',
							'data': {
								'image/png': [outputData]
							}
						})]);
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

	async executeCell(document: vscode.NotebookDocument, cell: vscode.NotebookCell | undefined, token: vscode.CancellationToken) {
		if (!cell) {
			// run them all
			for (let cell of document.cells) {
				if (cell.cellKind === vscode.CellKind.Code) {
					await this.executeCell(document, cell, token);
				}
			}
			return;
		}

		if (!this._terminal) {
			await this.startKernel()	
		}		

		if (cell) {
			let encoded_code = Buffer.from(cell.source).toString('base64');
			this._socket.write(`${this._current_request_id}:${encoded_code}\n`);
			this.request_id_to_cell.set(this._current_request_id, cell);
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

export class JuliaNotebookProvider implements vscode.NotebookProvider {
	private _onDidChangeNotebook = new vscode.EventEmitter<{ resource: vscode.Uri; notebook: vscode.NotebookDocument; }>();
	onDidChangeNotebook: vscode.Event<{ resource: vscode.Uri; notebook: vscode.NotebookDocument; }> = this._onDidChangeNotebook.event;
	private _notebooks: Map<string, JuliaNotebook> = new Map();

	constructor(private _extensionPath: string) {
	}

	async resolveNotebook(editor: vscode.NotebookEditor): Promise<void> {
		try {
			let content = await vscode.workspace.fs.readFile(editor.document.uri);

			let lines = content.toString().split('\n');
			let json: {cells: RawCell[]} = {cells: []};

			let current_md: string[] = [];
			let current_code: string[] = [];
			let inCodeCell = false;

			for (let i in lines) {
				if (lines[i].startsWith('```julia')) {
					inCodeCell = true

					json.cells.push({cell_type: 'markdown', source: current_md, metadata: undefined})
					current_md = [];
				}
				else if (lines[i].startsWith('```')) {
					inCodeCell = false

					json.cells.push({cell_type: 'code', source: current_code, outputs: [], metadata: undefined})
					current_code = []
				}
				else if (inCodeCell) {
					current_code.push(lines[i])
				}
				else {
					current_md.push(lines[i])
				}
			}
			if (inCodeCell) {
				json.cells.push({cell_type: 'code', source: current_code, outputs: [], metadata: undefined})
			}
			else {
				json.cells.push({cell_type: 'markdown', source: current_md, metadata: undefined})
				
			}
			
			let juliaNotebook = new JuliaNotebook(this._extensionPath, editor);
			await juliaNotebook.resolve(json);

			this._notebooks.set(editor.document.uri.toString(), juliaNotebook);
		} catch {

		}
	}

	async executeCell(document: vscode.NotebookDocument, cell: vscode.NotebookCell | undefined, token: vscode.CancellationToken): Promise<void> {
		let juliaNotebook = this._notebooks.get(document.uri.toString());

		if (juliaNotebook) {
			juliaNotebook.executeCell(document, cell, token);
		}
	}

	async save(document: vscode.NotebookDocument): Promise<boolean> {

		let content = document.cells.map(cell=>{
			if(cell.cellKind==vscode.CellKind.Markdown) {
				return cell.source;
			}
			else {
				return '```julia\n' + cell.source + '\n```';
			}
		}).join('\n');

		await vscode.workspace.fs.writeFile(document.uri, new TextEncoder().encode(content));
		
		return true
	}
}