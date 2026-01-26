import * as vscode from 'vscode'

import * as telemetry from '../telemetry'
import { getVersionedParamsAtPosition, registerCommand } from '../utils'
import * as modules from './modules'
import * as repl from './repl'
import * as results from './results'

let g_cellDelimiters: RegExp[] = [/^##(?!#)/, /^#(\s?)%%/, /^#(\s?)\+/, /^#(\s?)-/]

function updateCellDelimiters() {
    const delims = vscode.workspace.getConfiguration('julia').get<string[]>('cellDelimiters')
    if (delims !== undefined) {
        g_cellDelimiters = delims.map((s) => RegExp(s))
    }
}

// Cell structure explanation:
// - Each cell's cellRange extends from its delimiter to the next cell's delimiter.
// - The first cell always starts at the beginning of the document (position 0), regardless of delimiter positioning. (CodeLens assumes this.)
//   Specifically, in normal julia files, if a delimiter exists at position 0, the first cell might contain an empty range;
//   in Julia Markdown files, the range in the first cell is always empty.
// - The last cell always extends to the end of the document.
// - For cells with code, codeRange excludes the delimiter line.
// - All `cellRange` and `codeRange` are treated as closed on both ends,
//   even though console.log prints them as [xxx). Therefore,
//   * `vscode.Range.contains` (OK)
//   * `vscode.Range.isEmpty` (DO NOT USE, set as undefined if empty)
interface JuliaCell {
    id: number
    cellRange: vscode.Range
    codeRange?: vscode.Range
}

function isJmdDocument(document: vscode.TextDocument): boolean {
    return document.languageId === 'juliamarkdown' || document.languageId === 'markdown'
}

// Assumptions about JuliaCell arrays:
// - The `cellRange` properties in a JuliaCell array should not overlap.
// - The `id` values in all JuliaCell arrays should be in strictly increasing order.
// - The `cellRange.start` and `cellRange.end` values in all JuliaCell arrays should be in non-decreasing order.
// - For all `docCells` variables in this file,
//   the id of each JuliaCell should strictly equal its index in the array.
function getDocCells(document: vscode.TextDocument): JuliaCell[] {
    if (isJmdDocument(document)) {
        return getJmdDocCells(document)
    }
    const indexes: number[] = []
    if (g_cellDelimiters.length !== 0) {
        const regex = new RegExp(g_cellDelimiters.map((d) => d.source).join('|'), 'gm')
        const text = document.getText()
        let matches: RegExpExecArray | null
        while ((matches = regex.exec(text)) !== null) {
            indexes.push(matches.index)
        }
    }
    indexes.unshift(0) // Start with the start of the document
    indexes.push(document.getText().length + 1) // End with the end of the document
    const docCells: JuliaCell[] = []
    let id = 0
    const cellRangeStart = document.positionAt(indexes[id])
    const cellRangeEnd = document.positionAt(indexes[id + 1] - 1)
    docCells.push({
        id: id,
        cellRange: new vscode.Range(cellRangeStart, cellRangeEnd),
        codeRange: cellRangeEnd.isBeforeOrEqual(cellRangeStart)
            ? undefined
            : new vscode.Range(cellRangeStart, cellRangeEnd),
    })
    for (id = 1; id < indexes.length - 1; id++) {
        const cellRangeStart = document.positionAt(indexes[id])
        const cellRangeEnd = document.positionAt(indexes[id + 1] - 1)
        const cellRange = new vscode.Range(cellRangeStart, cellRangeEnd)
        const codeRangeStart = cellRangeStart.translate(1, 0)
        const codeRangeEnd = cellRangeEnd
        const codeRange = codeRangeEnd.isBefore(codeRangeStart)
            ? undefined
            : new vscode.Range(codeRangeStart, codeRangeEnd)
        docCells.push({
            id: id,
            cellRange: cellRange,
            codeRange: codeRange,
        })
    }
    return docCells
}

function getJmdDocCells(document: vscode.TextDocument): JuliaCell[] {
    const startRegex = /^```(?:{?julia|@example|@setup|@repl)/gm
    const endRegex = /^```(?!\w)/gm
    const text = document.getText()
    const docCells: JuliaCell[] = []
    let id = 0
    docCells.push({
        id: 0,
        cellRange: new vscode.Range(0, 0, 0, 0),
        codeRange: undefined,
    })
    id = 1
    let startMatch: RegExpExecArray | null
    while ((startMatch = startRegex.exec(text)) !== null) {
        const cellRangeStart = document.positionAt(startMatch.index)
        endRegex.lastIndex = startMatch.index + startMatch[0].length
        const endMatch = endRegex.exec(text)
        if (!endMatch) {
            const cellRangeEnd = document.positionAt(text.length)
            const codeRangeStart = cellRangeStart.translate(1, 0)
            docCells.push({
                id: id++,
                cellRange: new vscode.Range(cellRangeStart, cellRangeEnd),
                codeRange: new vscode.Range(codeRangeStart, cellRangeEnd),
            })
            break
        }
        const cellRangeEnd = document.positionAt(endMatch.index + endMatch[0].length - 1)
        const codeRangeStart = cellRangeStart.translate(1, 0)
        const codeRangeEnd = document.positionAt(endMatch.index - 1)
        docCells.push({
            id: id++,
            cellRange: new vscode.Range(cellRangeStart, cellRangeEnd),
            codeRange: new vscode.Range(codeRangeStart, codeRangeEnd),
        })
        startRegex.lastIndex = endMatch.index + endMatch[0].length
    }
    return docCells
}

function _getDocCells(): JuliaCell[] {
    const editor = vscode.window.activeTextEditor
    if (editor === undefined) {
        return []
    }
    return getDocCells(editor.document)
}

// Return:
// - [] if cells is empty.
// - [cellX] if the cellX is strictly contains the position.
// - [cellX, cellY] if the position is between cellX and cellY.
// - [cell0, cell0] if the position is before the first cell.
// - [cellN, cellN] if the position is after the last cell.
function getCurrentCells(cells: JuliaCell[] = _getDocCells(), position?: vscode.Position): JuliaCell[] {
    if (cells.length === 0) {
        return []
    }
    if (position === undefined) {
        position = vscode.window.activeTextEditor.selection.active
    }
    if (position.isBefore(cells[0].cellRange.start)) {
        return [cells[0], cells[0]]
    }
    let last: number = 0
    while (last < cells.length) {
        const cellRange = cells[last].cellRange
        if (position.isBeforeOrEqual(cellRange.end)) {
            break
        }
        last++
    }
    if (last === cells.length) {
        return [cells[last - 1], cells[last - 1]]
    }
    if (cells[last].cellRange.start.isBeforeOrEqual(position)) {
        return [cells[last]]
    } else {
        return [cells[last - 1], cells[last]]
    }
}

// Get previous valid cell which contains code
function getPreviousCell(position: vscode.Position, cells: JuliaCell[] = _getDocCells()): JuliaCell | undefined {
    for (let i = cells.length - 1; i >= 0; i--) {
        const cell = cells[i]
        if (position.isBeforeOrEqual(cell.cellRange.start)) {
            continue
        }
        if (cell.cellRange.contains(position)) {
            continue
        }
        if (cell.codeRange !== undefined) {
            return cell
        }
    }
    return cells.at(0)
}

// Get next valid cell which contains code
function getNextCell(position: vscode.Position, cells: JuliaCell[] = _getDocCells()): JuliaCell | undefined {
    for (const cell of cells) {
        if (cell.cellRange.end.isBeforeOrEqual(position)) {
            continue
        }
        if (cell.cellRange.contains(position)) {
            continue
        }
        if (cell.codeRange !== undefined) {
            return cell
        }
    }
    return cells.at(-1)
}

function _cellMove(editor: vscode.TextEditor, cells: JuliaCell[], direction: 'down' | 'up', docCells: JuliaCell[]) {
    const nextCell =
        direction === 'down'
            ? getNextCell(cells.at(0).cellRange.end, docCells)
            : getPreviousCell(cells.at(-1).cellRange.start, docCells)
    const nextPosition = nextCell.codeRange?.start ?? nextCell.cellRange.start
    repl.validateMoveAndReveal(editor, nextPosition, nextPosition)
}

function cellMove(
    cell?: JuliaCell,
    direction: 'down' | 'up' = 'down',
    docCells: JuliaCell[] = _getDocCells()
): boolean {
    telemetry.traceEvent('command-cellMove')
    const editor = vscode.window.activeTextEditor
    if (editor === undefined) {
        return false
    }
    const cells = cell ? [cell] : getCurrentCells(docCells)
    _cellMove(editor, cells, direction, docCells)
    return true
}

async function _commandCommonSave(editor: vscode.TextEditor): Promise<boolean> {
    if (editor === undefined) {
        return false
    }
    if (vscode.workspace.getConfiguration('julia').get<boolean>('execution.saveOnEval') === true) {
        await editor.document.save()
    }
    return true
}

const PENDING_SIGN = ' ⧗ '

async function _executeCellsInline(editor: vscode.TextEditor, cells: JuliaCell[]): Promise<boolean> {
    const document = editor.document
    const codeRanges: vscode.Range[] = cells.map((cell) => cell.codeRange).filter((cr) => cr !== undefined)
    const cellPendings: results.Result[] = codeRanges.map((codeRange) =>
        results.addResult(editor, codeRange, PENDING_SIGN, '')
    )
    await repl.startREPL(true, false)
    const { module } = await modules.getModuleForEditor(document, codeRanges[0].start)
    for (const cell of cells) {
        cellPendings.shift().remove(true)
        if (cell.codeRange === undefined) {
            continue
        }
        const codeRange = cell.codeRange
        let currentPos: vscode.Position = document.validatePosition(codeRange.start)
        let lastRange = new vscode.Range(0, 0, 0, 0)
        while (currentPos.isBefore(codeRange.end)) {
            const [startPos, endPos, nextPos] = await repl.getBlockRange(
                getVersionedParamsAtPosition(document, currentPos)
            )
            const lineEndPos = document.validatePosition(new vscode.Position(endPos.line, Infinity))
            const curRange = codeRange.intersection(new vscode.Range(startPos, lineEndPos))
            if (curRange === undefined || curRange.isEqual(lastRange)) {
                break
            }
            lastRange = curRange
            if (curRange.isEmpty) {
                continue
            }
            currentPos = document.validatePosition(nextPos)
            const code = document.getText(curRange)
            const success: boolean = await repl.evaluate(editor, curRange, code, module)
            if (success === false) {
                cellPendings.map((cr) => cr.remove(true))
                return false
            }
        }
    }
    return true
}

async function _executeCells(editor: vscode.TextEditor, cells: JuliaCell[]): Promise<boolean> {
    if (vscode.workspace.getConfiguration('julia').get<boolean>('execution.inlineResultsForCellEvaluation') === true) {
        return await _executeCellsInline(editor, cells)
    }
    const document = editor.document
    const codeRanges: vscode.Range[] = cells.map((cell) => cell.codeRange).filter((cr) => cr !== undefined)
    const cellPendings: results.Result[] = codeRanges.map((codeRange) =>
        results.addResult(editor, codeRange, PENDING_SIGN, '')
    )
    const { module } = await modules.getModuleForEditor(document, codeRanges[0].start)
    await repl.startREPL(true, false)
    for (const codeRange of codeRanges) {
        cellPendings.shift().remove(true)
        const code = document.getText(codeRange)
        const success: boolean = await repl.evaluate(editor, codeRange, code, module)
        if (success === false) {
            cellPendings.map((cr) => cr.remove(true))
            return false
        }
    }
    return true
}

async function executeCell(cell?: JuliaCell): Promise<boolean> {
    telemetry.traceEvent('command-executeCell')
    const editor = vscode.window.activeTextEditor
    if ((await _commandCommonSave(editor)) === false) {
        return false
    }
    if (cell === undefined) {
        const cells = getCurrentCells()
        if (cells.length !== 1) {
            return false
        }
        cell = cells[0]
    }
    return await _executeCells(editor, [cell])
}

async function executeCellAndMove(
    cell?: JuliaCell,
    direction: 'down' | 'up' = 'down',
    docCells: JuliaCell[] = _getDocCells()
): Promise<boolean> {
    telemetry.traceEvent('command-executeCellAndMove')
    const editor = vscode.window.activeTextEditor
    if ((await _commandCommonSave(editor)) === false) {
        return false
    }
    const cells = cell ? [cell] : getCurrentCells(docCells)
    _cellMove(editor, cells, direction, docCells)
    if (cells.length !== 1) {
        return false
    }
    return await _executeCells(editor, [cells[0]])
}

async function executeCurrentAndBelowCells(cell?: JuliaCell, docCells: JuliaCell[] = _getDocCells()): Promise<boolean> {
    telemetry.traceEvent('command-executeCurrentAndBelowCells')
    const editor = vscode.window.activeTextEditor
    if ((await _commandCommonSave(editor)) === false) {
        return false
    }
    const cells = cell ? [cell] : getCurrentCells(docCells)
    if (cells.length === 2 && cells[0].id === cells[1].id) {
        return false
    }
    return await _executeCells(editor, docCells.slice(cells.at(-1).id, docCells.length))
}

async function executeAboveCells(cell?: JuliaCell, docCells: JuliaCell[] = _getDocCells()): Promise<boolean> {
    telemetry.traceEvent('command-executeAboveCells')
    const editor = vscode.window.activeTextEditor
    if ((await _commandCommonSave(editor)) === false) {
        return false
    }
    const cells = cell ? [cell] : getCurrentCells(docCells)
    if (cells.length === 2 && cells[0].id === cells[1].id) {
        return false
    }
    return await _executeCells(editor, docCells.slice(0, cells[0].id))
}

export class CodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>()
    private docCells: JuliaCell[] = []
    private readonly decoration: vscode.TextEditorDecorationType
    private readonly currentCellTop: vscode.TextEditorDecorationType
    private readonly currentCellBottom: vscode.TextEditorDecorationType
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event
    private onDidChangeTextEditorSelectionHandler: vscode.Disposable | undefined

    constructor() {
        this.decoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
            isWholeLine: true,
        })
        this.currentCellTop = vscode.window.createTextEditorDecorationType({
            borderColor: new vscode.ThemeColor('interactive.activeCodeBorder'),
            borderWidth: '2px 0px 0px 0px',
            borderStyle: 'solid',
            isWholeLine: true,
        })
        this.currentCellBottom = vscode.window.createTextEditorDecorationType({
            borderColor: new vscode.ThemeColor('interactive.activeCodeBorder'),
            borderWidth: '0px 0px 1px 0px',
            borderStyle: 'solid',
            isWholeLine: true,
        })

        vscode.workspace.onDidChangeConfiguration(() => {
            this._onDidChangeCodeLenses.fire()
        })
        this.onDidChangeTextEditorSelectionHandler = vscode.window.onDidChangeTextEditorSelection(
            (event: vscode.TextEditorSelectionChangeEvent) => this.onDidChangeTextEditorSelection(event)
        )
    }

    private onDidChangeTextEditorSelection(event: vscode.TextEditorSelectionChangeEvent): void {
        const editor = event.textEditor
        const document = editor.document
        if (document.languageId !== 'julia') {
            return
        }
        this.docCells = getDocCells(document)
        if (this.docCells.length <= 1) {
            return
        }
        this.highlightCurrentCell(editor)
    }

    private highlightCurrentCell(editor: vscode.TextEditor): void {
        const cells = getCurrentCells(this.docCells, editor.selection.active)
        if (cells.length !== 1) {
            return
        }
        const cell = cells[0]
        editor.setDecorations(this.currentCellTop, [new vscode.Range(cell.cellRange.start, cell.cellRange.start)])
        editor.setDecorations(this.currentCellBottom, [new vscode.Range(cell.cellRange.end, cell.cellRange.end)])
    }

    private highlightCells(editor: vscode.TextEditor): void {
        const cellRanges = this.docCells.map((cell) => cell.cellRange).slice(1)
        editor.setDecorations(this.decoration, cellRanges)
    }

    private highlight(editor: vscode.TextEditor): void {
        if (isJmdDocument(editor.document)) {
            this.highlightCells(editor)
        } else {
            this.highlightCurrentCell(editor)
        }
    }

    public provideCodeLenses(
        document: vscode.TextDocument,
        // prettier-ignore
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = []
        this.docCells = getDocCells(document)
        if (this.docCells.length <= 1) {
            return codeLenses
        }
        const editor = vscode.window.activeTextEditor
        if (editor !== undefined && editor.document === document) {
            this.highlight(editor)
        }
        // The first cell would be skipped since it is preceded by a delimiter
        const cell = this.docCells[1]
        codeLenses.push(
            new vscode.CodeLens(cell.cellRange, {
                title: 'Run Cell',
                tooltip: 'Execute the cell in the Julia REPL',
                command: 'language-julia.executeCell',
                arguments: [cell, this.docCells],
            }),
            new vscode.CodeLens(cell.cellRange, {
                title: 'Run Below',
                tooltip: 'Execute all cells below in the Julia REPL',
                command: 'language-julia.executeCurrentAndBelowCells',
                arguments: [cell, this.docCells],
            })
        )
        for (const cell of this.docCells.slice(2)) {
            if (cell.codeRange === undefined) {
                continue
            }
            codeLenses.push(
                new vscode.CodeLens(cell.cellRange, {
                    title: 'Run Cell',
                    tooltip: 'Execute the cell in the Julia REPL',
                    command: 'language-julia.executeCell',
                    arguments: [cell, this.docCells],
                }),
                new vscode.CodeLens(cell.cellRange, {
                    title: 'Run Above',
                    tooltip: 'Execute all cells above in the Julia REPL',
                    command: 'language-julia.executeAboveCells',
                    arguments: [cell, this.docCells],
                })
            )
        }
        return codeLenses
    }

    // prettier-ignore
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public resolveCodeLens(codeLens: vscode.CodeLens, token: vscode.CancellationToken) {
        return codeLens
    }

    dispose() {
        this.onDidChangeTextEditorSelectionHandler?.dispose()
    }
}

export class FoldingRangeProvider implements vscode.FoldingRangeProvider {
    public provideFoldingRanges(
        document: vscode.TextDocument,
        // prettier-ignore
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        context: vscode.FoldingContext,
        // prettier-ignore
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.FoldingRange[]> {
        const docCells = getDocCells(document)
        const foldingRanges: vscode.FoldingRange[] = []
        const cell = docCells[0]
        if (cell.codeRange !== undefined) {
            foldingRanges.push(
                new vscode.FoldingRange(
                    cell.cellRange.start.line,
                    cell.cellRange.end.line,
                    vscode.FoldingRangeKind.Imports
                )
            )
        }
        for (const cell of docCells.slice(1)) {
            if (cell.codeRange === undefined) {
                continue
            }
            foldingRanges.push(
                new vscode.FoldingRange(
                    cell.cellRange.start.line,
                    cell.cellRange.end.line,
                    vscode.FoldingRangeKind.Region
                )
            )
        }
        return foldingRanges
    }
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (event.affectsConfiguration('julia.cellDelimiters')) {
                updateCellDelimiters()
            }
        })
    )

    // Register commands
    registerCommand('language-julia.moveCellUp', () => cellMove(undefined, 'up'))
    registerCommand('language-julia.moveCellDown', () => cellMove(undefined, 'down'))
    registerCommand('language-julia.executeCell', executeCell)
    registerCommand('language-julia.executeCellAndMove', executeCellAndMove)
    registerCommand('language-julia.executeCurrentAndBelowCells', executeCurrentAndBelowCells)
    registerCommand('language-julia.executeAboveCells', executeAboveCells)

    updateCellDelimiters()
}
