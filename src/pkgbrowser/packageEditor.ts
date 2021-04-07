import * as toml from '@iarna/toml'
import * as path from 'path'
import * as vscode from 'vscode'


type uuid = string

type TomlDependencies = { [packageName: string]: uuid }

type ProjectToml = {
	authors?: string[],
	compat?: TomlDependencies,
	deps?: TomlDependencies,
	extras?: TomlDependencies,
	name: string,
	targets?: object,
	uuid?: uuid
	version?: string,
}

type ManifestDependency = {
	uuid?: uuid,
	deps?: string[],
	version?: string,
	path?: string,
	'repo-url'?: string,
	'repo-rev'?: string,
	'git-tree-sha1'?: string,
}

type ManifestToml = { [key: string]: Array<ManifestDependency> }


export class PackageEditorProvider implements vscode.CustomTextEditorProvider {
	private static readonly viewType = 'language-julia.packagesEditor';

	constructor(
		private readonly context: vscode.ExtensionContext
	) {
	    console.log(this.updateTextDocument)
	}

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
	    const provider = new PackageEditorProvider(context)
	    const providerRegistration = vscode.window.registerCustomEditorProvider(PackageEditorProvider.viewType, provider)
	    return providerRegistration
	}

	private parseTomlDoc(document: vscode.TextDocument) {
	    const { fileName, getText } = document

	    const tomlType = path.basename(fileName, '.toml')
	    const tomlAsJSON = toml.parse(getText())

	    let packages: TomlDependencies
	    if (tomlType === 'Project') {
	        packages = this.parseProjectToml(tomlAsJSON as ProjectToml)
	    } else if (tomlType === 'Manifest') {
	        packages = this.parseManifestToml(tomlAsJSON as ManifestToml)
	    }
	    return packages
	}

	private parseProjectToml(tomlAsJSON: ProjectToml): TomlDependencies {
	    const { deps } = tomlAsJSON
	    return deps
	}

	private parseManifestToml(tomlAsJSON: ManifestToml): TomlDependencies {
	    const packages = {}
	    for (const pkg in tomlAsJSON) {
	        packages[pkg] = tomlAsJSON[pkg][0].uuid
	    }

	    return packages
	}

	private buildPackagesList(doc: vscode.TextDocument) {
	    const packages = this.parseTomlDoc(doc)
	    const pkgsNames = Object.keys(packages)
	    const htmlList = pkgsNames.map(name =>
	        `<div class="pkg"><h4>${name}</h4><span>${packages[name]}</span></div>`)
	        .join('')
	    return htmlList
	}

	/**
	 * Called when our custom editor is opened.
	 *
	 *
	 */
	public async resolveCustomTextEditor(
	    document: vscode.TextDocument,
	    webviewPanel: vscode.WebviewPanel,
	    _token: vscode.CancellationToken
	): Promise<void> {
	    // Setup initial content for the webview
	    webviewPanel.webview.options = {
	        enableScripts: true,
	        enableCommandUris: true,
	    }

	    const packagesList = this.buildPackagesList(document)
	    webviewPanel.webview.html = this.createWebviewHTML(packagesList, webviewPanel)

	    function updateWebview() {
	        webviewPanel.webview.postMessage({
	            type: 'update',
	            text: document.getText(),
	        })
	    }

	    // Hook up event handlers so that we can synchronize the webview with the text document.
	    //
	    // The text document acts as our model, so we have to sync change in the document to our
	    // editor and sync changes in the editor back to the document.
	    //
	    // Remember that a single text document can also be shared between multiple custom
	    // editors (this happens for example when you split a custom editor)

	    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
	        if (e.document.uri.toString() === document.uri.toString()) {
	            updateWebview()
	        }
	    })

	    // Make sure we get rid of the listener when our editor is closed.
	    webviewPanel.onDidDispose(() => {
	        changeDocumentSubscription.dispose()
	    })

	    // Receive message from the webview.
	    webviewPanel.webview.onDidReceiveMessage(e => {
	        switch (e.type) {
	        case 'search':
	            this.searchPackage(e.query)
	        }
	    })

	    updateWebview()
	}

	/**
	 * Get the static html used for the editor webviews.
	 */
	private createWebviewHTML(pkgsList: string, view: vscode.WebviewPanel): string {
	    const extensionPath = this.context.extensionPath

	    const googleFontscss = view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'google_fonts', 'css')))
	    const fontawesomecss = view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'fontawesome', 'fontawesome.min.css')))
	    const solidcss = view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'fontawesome', 'solid.min.css')))
	    const brandscss = view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'fontawesome', 'brands.min.css')))
	    console.log(fontawesomecss)

	    return `
		<html lang="en" class='theme--documenter-vscode'>

		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			<title>Julia Package Editor</title>
			<link href=${googleFontscss} rel="stylesheet" type="text/css" />
			<link href=${fontawesomecss} rel="stylesheet" type="text/css" />
			<link href=${solidcss} rel="stylesheet" type="text/css" />
			<link href=${brandscss} rel="stylesheet" type="text/css" />
			<style>
			body:active {
				outline: 1px solid var(--vscode-focusBorder);
			}

			.pkgs-list {
  				padding-top: 2rem;
				display: grid;
				grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
				grid-auto-rows: auto;
				grid-gap: 1rem;
			}

			.pkg {
				cursor: pointer;
				border: 2px solid #e7e7e7;
				border-radius: 4px;
				padding: .5rem;
			}

			span {
				margin-left: 5px;
			}

			.pkg:hover {
				background-color: var(--vscode-button-hoverBackground);
			}

			ol, li, span, h4 {
				margin: 0;
			}

			h4 {
				position: relative;
			}

			.search {
				display: grid;
				grid-column-gap: 12px;
				grid-template-columns: 5fr 1fr;
				background-color: var(--vscode-sideBar-background);
				width: 100%;
				padding: 5px;
			}

			.search input[type="text"] {
				background-color: var(--vscode-input-background);
				border: none;
				outline: none;
				color: var(--vscode-input-foreground);
			}

			.search input[type="text"]:focus {
				outline: 1px solid var(--vscode-editorWidget-border);
			}

			.container {
				padding: 1em;
			}

			button {
				display: inline;
				border: none;
				box-sizing: border-box;
				padding: 5px 7px;
				text-align: center;
				cursor: pointer;
				justify-content: center;
				align-items: center;
				background-color: var(--vscode-button-background);
				color: var(--vscode-button-foreground);
				font-family: var(--vscode-font-family);
			}

			button:hover {
				background-color: var(--vscode-button-hoverBackground);
			}

			button:focus {
				outline: 1px solid var(--vscode-focusBorder);
				outline-offset: 0px;
			}

			.plus {
				display: block;
				margin: auto;
				width: 20px;
				height: 20px;
				background:
					linear-gradient(var(--vscode-icon-foreground), var(--vscode-icon-foreground)),
					linear-gradient(var(--vscode-icon-foreground), var(--vscode-icon-foreground));
				background-position:center;
				background-size: 50% 2px,2px 50%; /*thickness = 2px, length = 50% (25px)*/
				background-repeat:no-repeat;
			}
			</style>

		</head>

		<body>
			<div class="container">
				<div class="search">
					<input id="search-input" type="text" placeholder="Package name"></input>
					<button>Search</button>
				</div>
				<div class="pkgs-list">
					<div class="pkg">
						<div class="plus"></div>
					</div>
					${pkgsList}
				</div>
			</div>
			<script>
				const vscode = acquireVsCodeApi()

				function search(val) {
					if (val) {
						vscode.postMessage({
							type: 'search',
							query: val
						})
					}
				}
				function onKeyDown(ev) {
					console.log(ev.keyCode)
					const val = document.getElementById('search-input').value
					search(val)
				}
				document.getElementById('search-input').addEventListener('keydown', onKeyDown)
			</script>
		</body>

		</html>
    `
	}

	private searchPackage(name: string) {
	    // TODO
	    console.log(name)
	}

	/**
	 * Write out the json to a given document.
	 */
	private updateTextDocument(document: vscode.TextDocument, json: any) {
	    const edit = new vscode.WorkspaceEdit()

	    // Just replace the entire document every time for this example extension.
	    // A more complete extension should compute minimal edits instead.
	    edit.replace(
	        document.uri,
	        new vscode.Range(0, 0, document.lineCount, 0),
	        JSON.stringify(json, null, 2))

	    return vscode.workspace.applyEdit(edit)
	}
}
