import * as vscode from 'vscode'

export class CodelensProvider implements vscode.CodeLensProvider {

    private codeLenses: vscode.CodeLens[] = []
    private cellDelimiters: string[] = []
    private regex: RegExp
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>()
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event

    constructor() {
        vscode.workspace.onDidChangeConfiguration((_) => {
            this._onDidChangeCodeLenses.fire()
        })
    }

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        this.cellDelimiters = vscode.workspace.getConfiguration('julia').get<string[]>('cellDelimiters') // ['^##(?!#)', '^#(\\s?)%%', '^#-']
        if (this.cellDelimiters === undefined || this.cellDelimiters.length === 0) {
            return []
        }
        this.regex = new RegExp(this.cellDelimiters.join('|'), 'gm')
        this.codeLenses = []
        const regex = new RegExp(this.regex)
        const text = document.getText()
        let matches
        while ((matches = regex.exec(text)) !== null) {
            const line = document.lineAt(document.positionAt(matches.index).line)
            const indexOf = line.text.indexOf(matches[0])
            const position = new vscode.Position(line.lineNumber, indexOf)
            const range = document.getWordRangeAtPosition(position, new RegExp(this.regex))
            if (range) {
                this.codeLenses.push(
                    new vscode.CodeLens(range, {
                        title: 'Run Cell',
                        tooltip: 'Execute the cell in the Julia REPL',
                        command: 'julia.executeCell',
                        arguments: [false],
                    }),
                    new vscode.CodeLens(range, {
                        title: 'Run Above',
                        tooltip: 'Execute all cells above in the Julia REPL',
                        command: 'julia.executeCell', // TODO: Add a new command for this
                    }),
                )
            }
        }
        return this.codeLenses
    }

    public resolveCodeLens(codeLens: vscode.CodeLens, token: vscode.CancellationToken) {
        return codeLens
    }
}
