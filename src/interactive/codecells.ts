import * as vscode from 'vscode'


let g_cellDelimiters = [
    /^##(?!#)/,
    /^#(\s?)%%/
]

function updateCellDelimiters() {
    const delims = vscode.workspace.getConfiguration('julia').get<string[]>('cellDelimiters')
    if (delims) {
        g_cellDelimiters = delims.map(s => RegExp(s))
    }
}

// Cell structure explanation:
// - Each cell's cellRange extends from its delimiter to the next cell's delimiter.
// - The first cell always starts at the beginning of the document (position 0), regardless of delimiter positioning.
//   This means if a delimiter exists at position 0, the first cell might contain an empty range.
// - The last cell always extends to the end of the document.
// - For cells with code, codeRange excludes the delimiter line.
interface JuliaCell {
    id: number,
    cellRange: vscode.Range,
    codeRange?: vscode.Range,
}

export function getCells(document: vscode.TextDocument): JuliaCell[] {
    const indexes: number[] = []
    if (g_cellDelimiters.length !== 0) {
        const regex = new RegExp(g_cellDelimiters.map(d => d.source).join('|'), 'gm')
        const text = document.getText()
        let matches: RegExpExecArray | null
        while ((matches = regex.exec(text)) !== null) {
            indexes.push(matches.index)
        }
    }
    // if (indexes.length === 0 || indexes[0] !== 0) {
    //     indexes.unshift(0) // Start with the start of the document
    // }
    indexes.unshift(0) // Start with the start of the document
    indexes.push(document.getText().length) // End with the end of the document
    const cells: JuliaCell[] = []
    for (let i = 0; i < indexes.length - 1; i++) {
        const cellRangeStart = document.positionAt(indexes[i])
        const CellRangeEnd = document.positionAt(indexes[i + 1])
        const cellRange = new vscode.Range(
            cellRangeStart,
            CellRangeEnd
        )
        const codeRangeStart = cellRangeStart.translate(1, 0)
        const codeRangeEnd = CellRangeEnd
        const codeRange = codeRangeStart.isAfter(codeRangeEnd) // isAfterOrEqual?
            ? undefined
            : new vscode.Range(
                codeRangeStart,
                codeRangeEnd
            )
        cells.push({
            id: i,
            cellRange: cellRange,
            codeRange: codeRange,
        })
    }
    return cells
}

function _getCells(): JuliaCell[] {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
        return []
    }
    return getCells(editor.document)
}

function _getDefaultCell(): JuliaCell {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
        return undefined
    }
    const document = editor.document
    const range = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
    )
    return {
        id: 0,
        cellRange: range,
        codeRange: range,
    }
}

function getCurrentCell(
    position: vscode.Position,
    cells: JuliaCell[] = _getCells(),
): JuliaCell | undefined {
    for (const cell of cells) {
        if (cell.cellRange.contains(position)) {
            return cell
        }
    }
    return undefined
}

// Get previous valid cell which contains code
function getPreviousCell(
    position: vscode.Position,
    cells:JuliaCell[] = _getCells(),
): JuliaCell | undefined {
    for (let i = cells.length - 1; i >= 0; i--) {
        const cell = cells[i]
        if (cell.cellRange.start.isAfterOrEqual(position) || cell.cellRange.contains(position)) {
            continue
        }
        if (cell.codeRange) {
            return cell
        }
    }
    return cells[1] || cells[0]
}

// Get next valid cell which contains code
function getNextCell(
    position: vscode.Position,
    cells: JuliaCell[] = _getCells(),
): JuliaCell | undefined {
    for (const cell of cells) {
        if (cell.cellRange.end.isBeforeOrEqual(position) || cell.cellRange.contains(position)) {
            continue
        }
        if (cell.codeRange) {
            return cell
        }
    }
    return cells[cells.length - 1]
}

export class CodelensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>()
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event

    constructor() {
        vscode.workspace.onDidChangeConfiguration((_) => {
            this._onDidChangeCodeLenses.fire()
        })
    }

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.CodeLens[] | Thenable<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = []
        const cells = getCells(document)
        // The first cell would be skipped since it is preceded by a delimiter
        let cell = cells[1]
        codeLenses.push(
            new vscode.CodeLens(cell.cellRange, {
                title: 'Run Cell',
                tooltip: 'Execute the cell in the Julia REPL',
                command: 'julia.executeCell',
                arguments: [cell.cellRange.start],
            }),
            new vscode.CodeLens(cell.cellRange, {
                title: 'Run Below',
                tooltip: 'Execute all cells below in the Julia REPL',
                command: 'julia.executeCurrentAndBelowCells',
                arguments: [cell.cellRange.start],
            }),
        )
        for (let i = 2; i < cells.length; i++) {
            cell = cells[i]
            if (cell.codeRange) {
                codeLenses.push(
                    new vscode.CodeLens(cell.cellRange, {
                        title: 'Run Cell',
                        tooltip: 'Execute the cell in the Julia REPL',
                        command: 'julia.executeCell',
                        arguments: [cell.cellRange.start],
                    }),
                    new vscode.CodeLens(cell.cellRange, {
                        title: 'Run Above',
                        tooltip: 'Execute all cells above in the Julia REPL',
                        command: 'julia.executeAboveCells',
                        arguments: [cell.cellRange.start],
                    }),
                )
            }
        }
        return codeLenses
    }

    public resolveCodeLens(codeLens: vscode.CodeLens, token: vscode.CancellationToken) {
        return codeLens
    }
}


export function activate(context: vscode.ExtensionContext) {

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async event => {
            if (event.affectsConfiguration('julia.cellDelimiters')) {
                updateCellDelimiters()
            }
        }),
    )

    updateCellDelimiters()
}
