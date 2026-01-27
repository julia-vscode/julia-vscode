import * as vscode from 'vscode'

import * as telemetry from '../telemetry'
import { registerCommand } from '../utils'
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
    const endPosition = document.lineAt(document.lineCount - 1).range.end
    indexes.push(document.offsetAt(endPosition) + 1) // End with the end of the document
    const docCells: JuliaCell[] = []
    for (let id = 0; id < indexes.length - 1; id++) {
        const cellRangeStart = document.positionAt(indexes[id])
        const cellRangeEnd = document.positionAt(indexes[id + 1] - 1)
        const cellRange = new vscode.Range(cellRangeStart, cellRangeEnd)
        const codeRangeStart = id === 0 ? cellRangeStart : cellRangeStart.translate(1, 0)
        const codeRangeEnd = cellRangeEnd
        const codeRange =
            id === 0
                ? codeRangeEnd.isBeforeOrEqual(codeRangeStart)
                    ? undefined
                    : new vscode.Range(codeRangeStart, codeRangeEnd)
                : codeRangeEnd.isBefore(codeRangeStart)
                  ? undefined
                  : new vscode.Range(codeRangeStart, codeRangeEnd)
        docCells.push({
            id,
            cellRange,
            codeRange,
        })
    }
    return docCells
}

function getJmdDocCells(document: vscode.TextDocument): JuliaCell[] {
    const startRegex = /^```(?:{?julia|@example|@setup|@repl)/gm
    const endRegex = /^```(?!\w)/gm
    const text = document.getText()
    const docCells: JuliaCell[] = []
    docCells.push({
        id: 0,
        cellRange: new vscode.Range(0, 0, 0, 0),
        codeRange: undefined,
    })
    let startMatch: RegExpExecArray | null
    for (let id = 1; (startMatch = startRegex.exec(text)) !== null; id++) {
        const cellRangeStart = document.positionAt(startMatch.index)
        endRegex.lastIndex = startMatch.index + startMatch[0].length
        const endMatch = endRegex.exec(text)
        const cellRangeEnd = endMatch
            ? document.positionAt(endMatch.index + endMatch[0].length - 1)
            : document.positionAt(text.length)
        const codeRangeStart = cellRangeStart.translate(1, 0)
        const codeRangeEnd = endMatch ? document.positionAt(endMatch.index - 1) : cellRangeEnd
        docCells.push({
            id,
            cellRange: new vscode.Range(cellRangeStart, cellRangeEnd),
            codeRange: new vscode.Range(codeRangeStart, codeRangeEnd),
        })
        if (!endMatch) {
            break
        }
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

interface CellContext {
    /** Infimum cell of the current selections, undefined if no cells exist */
    inf?: JuliaCell
    /** All cells intersecting with the current selections, empty if no cells exist */
    current: JuliaCell[]
    /** Supremum cell of the current selections, undefined if no cells exist */
    sup?: JuliaCell
}

function getSelectionsCellContext(
    docCells: readonly JuliaCell[] = _getDocCells(),
    selections: readonly vscode.Selection[] = vscode.window.activeTextEditor?.selections ?? []
): CellContext {
    if (docCells.length === 0 || selections.length === 0) {
        return {
            inf: undefined,
            current: [],
            sup: undefined,
        }
    }
    const sortedSelections = [...selections].sort((a, b) => a.start.compareTo(b.start))
    const firstPos = sortedSelections[0].start
    const infIndex = _findSortedInfCellIndex(docCells, firstPos, 0)
    let inf: JuliaCell
    if (infIndex === -1) {
        inf = docCells[docCells.length - 1]
    } else if (firstPos.isBefore(docCells[infIndex].cellRange.start)) {
        inf = infIndex === 0 ? docCells[0] : docCells[infIndex - 1]
    } else {
        inf = docCells[infIndex]
    }
    const currentCells = new Set<JuliaCell>()
    // We use `searchHintIndex` to optimize the search.
    let searchHintIndex = infIndex !== -1 ? infIndex : docCells.length
    let maxEnd = sortedSelections[0].end
    for (const selection of sortedSelections) {
        // Update maxEnd if this selection extends further than any previous one.
        // This handles overlapping cases like selA=[0,100], selB=[10,20].
        if (selection.end.isAfter(maxEnd)) {
            maxEnd = selection.end
        }
        let idx = _findSortedInfCellIndex(docCells, selection.start, searchHintIndex)
        if (idx === -1) {
            searchHintIndex = docCells.length
            continue
        }
        searchHintIndex = idx
        while (idx < docCells.length) {
            const cell = docCells[idx]
            if (cell.cellRange.start.isAfter(selection.end)) {
                break
            }
            if (selection.intersection(cell.cellRange)) {
                currentCells.add(cell)
            } else if (selection.isEmpty && cell.cellRange.contains(selection.active)) {
                currentCells.add(cell)
            }
            idx++
        }
    }
    const supIndex = _findSortedInfCellIndex(docCells, maxEnd, infIndex)
    let sup: JuliaCell
    if (supIndex === -1) {
        sup = docCells[docCells.length - 1]
    } else if (maxEnd.isBefore(docCells[supIndex].cellRange.end)) {
        sup = docCells[supIndex]
    } else {
        sup = supIndex + 1 < docCells.length ? docCells[supIndex + 1] : docCells[docCells.length - 1]
    }
    return {
        inf,
        current: Array.from(currentCells).sort((a, b) => a.id - b.id),
        sup,
    }
}

/**
 * Binary search to find the index of the first cell whose end is >= position
 *
 * @param docCells - Array of JuliaCell, assumed to be sorted by cellRange.start
 * @param position - The Position to search for
 * @param searchStartIdx - Optimization: The index to start searching from
 * @returns The index of the first cell whose end is >= position, or -1 if none found
 */
function _findSortedInfCellIndex(
    docCells: readonly JuliaCell[],
    position: vscode.Position,
    searchStartIdx: number = 0
): number {
    let low = searchStartIdx
    let high = docCells.length - 1
    let result = -1
    while (low <= high) {
        const mid = (low + high) >>> 1
        const cell = docCells[mid]
        if (position.isBeforeOrEqual(cell.cellRange.end)) {
            result = mid
            high = mid - 1
        } else {
            low = mid + 1
        }
    }
    return result
}

// Get previous valid cell which contains code
function getPreviousCell(
    cellContext: CellContext,
    docCells: readonly JuliaCell[] = _getDocCells()
): JuliaCell | undefined {
    if (cellContext.inf === undefined || docCells.length === 0) {
        return undefined
    }
    const isClosedInterval = cellContext.current.at(0).id === cellContext.inf.id
    const startIdx = isClosedInterval ? cellContext.inf.id - 1 : cellContext.inf.id
    for (let i = startIdx; i >= 0; i--) {
        const cell = docCells[i]
        if (cell.codeRange !== undefined) {
            return cell
        }
    }
    return docCells.at(0)
}

// Get next valid cell which contains code
function getNextCell(cellContext: CellContext, docCells: readonly JuliaCell[] = _getDocCells()): JuliaCell | undefined {
    if (cellContext.sup === undefined || docCells.length === 0) {
        return undefined
    }
    const isClosedInterval = cellContext.current.at(-1).id === cellContext.sup.id
    const startIdx = isClosedInterval ? cellContext.sup.id + 1 : cellContext.sup.id
    for (let i = startIdx; i < docCells.length; i++) {
        const cell = docCells[i]
        if (cell.codeRange !== undefined) {
            return cell
        }
    }
    return docCells.at(-1)
}

function _cellMove(
    editor: vscode.TextEditor,
    cellContext: CellContext,
    direction: 'down' | 'up',
    docCells: readonly JuliaCell[]
) {
    const nextCell = direction === 'down' ? getNextCell(cellContext, docCells) : getPreviousCell(cellContext, docCells)
    const newPosition = nextCell.codeRange?.start ?? nextCell.cellRange.start
    repl.validateMoveAndReveal(editor, newPosition, newPosition)
}

function cellMove(
    cell?: JuliaCell,
    direction: 'down' | 'up' = 'down',
    docCells: readonly JuliaCell[] = _getDocCells()
): boolean {
    telemetry.traceEvent('command-cellMove')
    const editor = vscode.window.activeTextEditor
    if (editor === undefined) {
        return false
    }
    const cellContext = cell
        ? ({
              inf: cell,
              current: [cell],
              sup: cell,
          } satisfies CellContext)
        : getSelectionsCellContext(docCells)
    _cellMove(editor, cellContext, direction, docCells)
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

async function _executeCells(editor: vscode.TextEditor, cells: readonly JuliaCell[]): Promise<boolean> {
    const document = editor.document
    const codeRanges: vscode.Range[] = cells.map((cell) => cell.codeRange).filter((cr) => cr !== undefined)
    const cellPendings: results.Result[] = codeRanges.map((codeRange) =>
        results.addResult(editor, codeRange, PENDING_SIGN, '')
    )
    const isInline = vscode.workspace
        .getConfiguration('julia')
        .get<boolean>('execution.inlineResultsForCellEvaluation', false)
    const { module } = await modules.getModuleForEditor(document, codeRanges[0].start)
    await repl.startREPL(true, false)
    for (const codeRange of codeRanges) {
        cellPendings.shift().remove(true)
        const code = document.getText(codeRange)
        if (isInline === true) {
            const r = Promise.race([
                repl.g_cellEvalQueue.push({ editor, cellRange: codeRange, module }),
                repl.g_evalQueue.drained(),
            ])
            if (!r) {
                repl.g_cellEvalQueue.kill()
                cellPendings.map((cr) => cr.remove(true))
                return false
            }
        } else {
            const success: boolean = await repl.evaluate(editor, codeRange, code, module)
            if (success === false) {
                cellPendings.map((cr) => cr.remove(true))
                return false
            }
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
    let cells: JuliaCell[]
    if (cell !== undefined) {
        cells = [cell]
    } else {
        const cellContext = getSelectionsCellContext()
        cells = cellContext.current
    }
    return await _executeCells(editor, cells)
}

async function executeCellAndMove(
    cell?: JuliaCell,
    direction: 'down' | 'up' = 'down',
    docCells: readonly JuliaCell[] = _getDocCells()
): Promise<boolean> {
    telemetry.traceEvent('command-executeCellAndMove')
    const editor = vscode.window.activeTextEditor
    if ((await _commandCommonSave(editor)) === false) {
        return false
    }
    const cellContext = cell
        ? ({
              inf: cell,
              current: [cell],
              sup: cell,
          } satisfies CellContext)
        : getSelectionsCellContext(docCells)
    _cellMove(editor, cellContext, direction, docCells)
    if (cellContext.current.length === 0) {
        return false
    }
    return await _executeCells(editor, cellContext.current)
}

async function executeCurrentAndBelowCells(cell?: JuliaCell, docCells: JuliaCell[] = _getDocCells()): Promise<boolean> {
    telemetry.traceEvent('command-executeCurrentAndBelowCells')
    const editor = vscode.window.activeTextEditor
    if ((await _commandCommonSave(editor)) === false) {
        return false
    }
    let beginId: number
    if (cell !== undefined) {
        beginId = cell.id
    } else {
        const cellContext = getSelectionsCellContext(docCells)
        if (cellContext.current.length === 0) {
            beginId = cellContext.sup?.id ?? docCells.length
        } else {
            beginId = cellContext.current.at(0).id
        }
    }
    return await _executeCells(editor, docCells.slice(beginId, docCells.length))
}

async function executeAboveCells(cell?: JuliaCell, docCells: readonly JuliaCell[] = _getDocCells()): Promise<boolean> {
    telemetry.traceEvent('command-executeAboveCells')
    const editor = vscode.window.activeTextEditor
    if ((await _commandCommonSave(editor)) === false) {
        return false
    }
    let endId: number
    if (cell !== undefined) {
        endId = cell.id
    } else {
        const cellContext = getSelectionsCellContext(docCells)
        if (cellContext.current.length === 0) {
            endId = cellContext.inf?.id ?? 0
        } else {
            endId = cellContext.current.at(-1).id
        }
    }
    return await _executeCells(editor, docCells.slice(0, endId))
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

        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('julia.cellDelimiters')) {
                this._onDidChangeCodeLenses.fire()
            }
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
        const cellContext = getSelectionsCellContext(this.docCells, [
            new vscode.Selection(editor.selection.active, editor.selection.active),
        ])
        const cells = cellContext.current
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

    private unhighlight(editor: vscode.TextEditor): void {
        editor.setDecorations(this.decoration, [])
        editor.setDecorations(this.currentCellTop, [])
        editor.setDecorations(this.currentCellBottom, [])
    }

    public provideCodeLenses(
        document: vscode.TextDocument,
        // prettier-ignore
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = []
        this.docCells = getDocCells(document)
        const editor = vscode.window.activeTextEditor
        if (editor === undefined || editor.document !== document) {
            return codeLenses
        }
        if (this.docCells.length <= 1) {
            this.unhighlight(editor)
            return codeLenses
        }
        this.highlight(editor)

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
        }),

        // Register commands
        registerCommand('language-julia.moveCellUp', () => cellMove(undefined, 'up')),
        registerCommand('language-julia.moveCellDown', () => cellMove(undefined, 'down')),
        registerCommand('language-julia.executeCell', executeCell),
        registerCommand('language-julia.executeCellAndMove', executeCellAndMove),
        registerCommand('language-julia.executeCurrentAndBelowCells', executeCurrentAndBelowCells),
        registerCommand('language-julia.executeAboveCells', executeAboveCells)
    )
    updateCellDelimiters()
}
