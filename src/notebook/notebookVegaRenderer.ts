
// export class VegaRenderer implements vscode.NotebookOutputRenderer {
// 	private _preloads: vscode.Uri[] = [];

// 	get preloads(): vscode.Uri[] {
// 		return this._preloads
// 	}

// 	constructor(
// 		private _extensionPath: string
// 	) {
// 		this._preloads.push(vscode.Uri.file(path.join(this._extensionPath, 'libs', 'vega-5', 'vega.min.js')))
// 		this._preloads.push(vscode.Uri.file(path.join(this._extensionPath, 'libs', 'vega-lite-4', 'vega-lite.min.js')))
// 		this._preloads.push(vscode.Uri.file(path.join(this._extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')))
// 	}

// 	render(document: vscode.NotebookDocument, output: vscode.CellOutput, mimeType: string): string {
// 		const renderOutputs: string[] = []
// 		const data = (output as vscode.CellDisplayOutput).data
// 		const trimmedData: { [key: string]: any } = {}
// 		trimmedData[mimeType] = data[mimeType]

// 		const divId = uuid()

// 		renderOutputs.push(`
// 			<div id="vis-${divId}"></div>
// 			<script type="text/javascript">
// 				vegaEmbed('#vis-${divId}', ${JSON.stringify(trimmedData)});
// 			</script>
// 		`)

// 		return renderOutputs.join('\n')
// 	}
// }
