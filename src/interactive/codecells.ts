import * as vscode from 'vscode'

import * as telemetry from '../telemetry'
import { registerCommand } from '../utils'
import * as modules from './modules'
import * as repl from './repl'
import * as results from './results'

/** Combine multiple events into one event that fires when any of them fire */
function anyEvent<T>(...events: vscode.Event<T>[]): vscode.Event<T> {
    return (listener: (e: T) => unknown, thisArgs?: unknown, disposables?: vscode.Disposable[]) => {
        const disposablesLocal: vscode.Disposable[] = []
        for (const e of events) {
            disposablesLocal.push(e(listener, thisArgs, disposables))
        }
        return vscode.Disposable.from(...disposablesLocal)
    }
}

/** A cell in a Julia document */
interface JuliaCell {
    /** Cell ID, starting from 0 */
    id: number
    /**
     * Range of the entire cell, including delimiters.
     * Closed at both ends, even though VS Code displays ranges as [start, end).
     * Therefore:
     * * `vscode.Range.contains` (OK)
     * * `vscode.Range.isEmpty` (DO NOT USE; `cellRange` is never empty)
     */
    cellRange: vscode.Range
    /**
     * Range of the code within the cell, excluding delimiters.
     * Closed at both ends, with the same notes as `cellRange` apply.
     * Undefined if the cell has no code.
     */
    codeRange?: vscode.Range
}

/** Cells in a Julia document */
interface JuliaDocCells {
    /** Document version when cells were last computed */
    version: number
    /** Language ID of the document */
    languageId: string
    /**
     * Cells in the document.
     *
     * The cells are ordered by appearance in the document,
     * and each cell's `id` matches its index in this array.
     * For regular Julia files, the first cell always starts at the beginning of the document,
     * regardless of whether a delimiter appears at that position,
     * and the last cell always ends at the end of the document.
     */
    cells: JuliaCell[]
}

interface CellContext {
    /** Infimum cell of the current selections, undefined if no cells exist */
    inf?: JuliaCell
    /** All cells intersecting with the current selections, empty if no cells exist */
    current: JuliaCell[]
    /** Supremum cell of the current selections, undefined if no cells exist */
    sup?: JuliaCell
}

class JuliaCellManager implements vscode.Disposable {
    private readonly documentCells = new Map<string, JuliaDocCells>()
    protected readonly onDidChangeCellDelimiters = new vscode.EventEmitter<void>()
    private readonly cellDelimiters: RegExp[] = []

    constructor(protected context: vscode.ExtensionContext) {
        this.updateCellDelimiters()
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument.bind(this)),
            vscode.workspace.onDidCloseTextDocument(this.onDidCloseTextDocument.bind(this)),
            vscode.workspace.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this))
        )
    }

    public dispose() {
        this.onDidChangeCellDelimiters.dispose()
    }

    protected onDidChangeConfiguration(event: vscode.ConfigurationChangeEvent) {
        if (event.affectsConfiguration('julia.cellDelimiters')) {
            this.updateCellDelimiters()
            this.clearDocCells()
            this.onDidChangeCellDelimiters.fire()
        }
    }

    protected onDidChangeTextDocument(event: vscode.TextDocumentChangeEvent) {
        this.updateDocCells(event.document)
    }

    protected onDidCloseTextDocument(document: vscode.TextDocument) {
        this.removeDocCells(document)
    }

    protected isJuliaDocument(document: vscode.TextDocument): boolean {
        return document.languageId === 'julia'
    }

    protected isJmdDocument(document: vscode.TextDocument): boolean {
        return document.languageId === 'juliamarkdown' || document.languageId === 'markdown'
    }

    private updateCellDelimiters() {
        const delims = vscode.workspace.getConfiguration('julia').get<string[]>('cellDelimiters')
        if (delims !== undefined) {
            this.cellDelimiters.length = 0
            for (const delim of delims) {
                try {
                    this.cellDelimiters.push(new RegExp(delim, 'm'))
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                } catch (e) {
                    console.warn(`Invalid cell delimiter regex: ${delim}`)
                }
            }
        }
    }

    protected getDocCells(document?: vscode.TextDocument): JuliaCell[] {
        if (document === undefined) {
            const editor = vscode.window.activeTextEditor
            if (editor === undefined) {
                return []
            }
            document = editor.document
        }
        this.updateDocCells(document)
        const documentKey = document.uri.toString()
        return this.documentCells.get(documentKey)?.cells ?? []
    }

    private updateDocCells(document: vscode.TextDocument): void {
        if (!this.isJuliaDocument(document) && !this.isJmdDocument(document)) {
            return
        }
        const documentKey = document.uri.toString()
        const version = document.version
        const languageId = document.languageId

        const docCells = this.documentCells.get(documentKey)
        if (docCells === undefined || docCells.version !== version || docCells.languageId !== languageId) {
            this.documentCells.set(documentKey, { version, languageId, cells: this.buildDocCells(document) })
        }
    }

    private removeDocCells(document: vscode.TextDocument): void {
        const documentKey = document.uri.toString()
        this.documentCells.delete(documentKey)
    }

    private clearDocCells(): void {
        this.documentCells.clear()
    }

    private buildDocCells(document: vscode.TextDocument): JuliaCell[] {
        if (this.isJmdDocument(document)) {
            return this.buildJmdDocCells(document)
        }
        const indexes: number[] = []
        if (this.cellDelimiters.length !== 0) {
            const regex = new RegExp(this.cellDelimiters.map((d) => d.source).join('|'), 'gm')
            const text = document.getText()
            let matches: RegExpExecArray | null
            while ((matches = regex.exec(text)) !== null) {
                indexes.push(matches.index)
            }
        }
        let hasDelimiterAtStart = true
        if (indexes[0] !== 0) {
            // No delimiter or first delimiter not at start
            hasDelimiterAtStart = false
            indexes.unshift(0)
        }
        const endPosition = document.lineAt(document.lineCount - 1).range.end
        indexes.push(document.offsetAt(endPosition) + 1) // End with the end of the document
        const docCells: JuliaCell[] = []
        for (let id = 0; id < indexes.length - 1; id++) {
            const cellRangeStart = document.positionAt(indexes[id])
            const cellRangeEnd = document.positionAt(indexes[id + 1] - 1)
            const cellRange = new vscode.Range(cellRangeStart, cellRangeEnd)
            const codeRangeStart = id === 0 && !hasDelimiterAtStart ? cellRangeStart : cellRangeStart.translate(1, 0)
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

    private buildJmdDocCells(document: vscode.TextDocument): JuliaCell[] {
        const startRegex = /^```(?:{?julia|@example|@setup|@repl)/gm
        const endRegex = /^```(?!\w)/gm
        const text = document.getText()
        const docCells: JuliaCell[] = []
        let startMatch: RegExpExecArray | null
        for (let id = 0; (startMatch = startRegex.exec(text)) !== null; id++) {
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

    protected getSelectionsCellContext(
        docCells: readonly JuliaCell[] = this.getDocCells(),
        selections: readonly vscode.Selection[] = vscode.window.activeTextEditor?.selections.slice() ?? []
    ): CellContext {
        if (docCells.length === 0 || selections.length === 0) {
            return {
                inf: undefined,
                current: [],
                sup: undefined,
            }
        }
        const sortedSelections = selections.slice().sort((a, b) => a.start.compareTo(b.start))
        const firstPos = sortedSelections[0].start
        const infIndex = this._findSortedInfCellIndex(docCells, firstPos, 0)
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
            let idx = this._findSortedInfCellIndex(docCells, selection.start, searchHintIndex)
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
        const supIndex = this._findSortedInfCellIndex(docCells, maxEnd, infIndex)
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
    private _findSortedInfCellIndex(
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
}

class CodeCellExecutionFeature extends JuliaCellManager {
    private readonly PENDING_SIGN = ' ⧗ '
    private shouldSaveOnEval: boolean
    private inlineResultsForCellEvaluation: boolean

    constructor(context: vscode.ExtensionContext) {
        super(context)
        this.updateSaveOnEval()
        this.updateInlineResultsForCellEvaluation()
        this.context.subscriptions.push(
            registerCommand('language-julia.moveCellUp', this.moveCell.bind(this, 'up')),
            registerCommand('language-julia.moveCellDown', this.moveCell.bind(this, 'down')),
            registerCommand('language-julia.selectCell', this.selectCell.bind(this)),
            registerCommand('language-julia.executeCell', this.executeCell.bind(this)),
            registerCommand('language-julia.executeCellAndMove', this.executeCellAndMove.bind(this, 'down')),
            registerCommand('language-julia.executeSelectionOrCell', this.executeSelectionOrCell.bind(this, false)),
            registerCommand(
                'language-julia.executeSelectionOrCellAndMove',
                this.executeSelectionOrCell.bind(this, true)
            ),
            registerCommand('language-julia.executeCurrentAndBelowCells', this.executeCurrentAndBelowCells.bind(this)),
            registerCommand('language-julia.executeAboveCells', this.executeAboveCells.bind(this))
        )
    }

    protected override onDidChangeConfiguration(event: vscode.ConfigurationChangeEvent) {
        super.onDidChangeConfiguration(event)
        if (event.affectsConfiguration('julia.execution.saveOnEval')) {
            this.updateSaveOnEval()
        }
        if (event.affectsConfiguration('julia.execution.inlineResultsForCellEvaluation')) {
            this.updateInlineResultsForCellEvaluation()
        }
    }

    private updateSaveOnEval() {
        this.shouldSaveOnEval = vscode.workspace.getConfiguration('julia').get<boolean>('execution.saveOnEval', false)
    }

    private updateInlineResultsForCellEvaluation() {
        this.inlineResultsForCellEvaluation = vscode.workspace
            .getConfiguration('julia')
            .get<boolean>('execution.inlineResultsForCellEvaluation', false)
    }

    /** Get previous valid cell which contains code */
    private _getPreviousCell(cellContext: CellContext, docCells: readonly JuliaCell[]): JuliaCell | undefined {
        if (cellContext.inf === undefined || docCells.length === 0) {
            return undefined
        }
        const isClosedInterval = cellContext.current[0].id === cellContext.inf.id
        const startIdx = isClosedInterval ? cellContext.inf.id - 1 : cellContext.inf.id
        for (let i = startIdx; i >= 0; i--) {
            const cell = docCells[i]
            if (cell.codeRange !== undefined) {
                return cell
            }
        }
        return docCells[0]
    }

    /** Get next valid cell which contains code */
    private _getNextCell(cellContext: CellContext, docCells: readonly JuliaCell[]): JuliaCell | undefined {
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

    private _moveCell(
        editor: vscode.TextEditor,
        cellContext: CellContext,
        direction: 'down' | 'up',
        docCells: readonly JuliaCell[]
    ) {
        const nextCell =
            direction === 'down'
                ? this._getNextCell(cellContext, docCells)
                : this._getPreviousCell(cellContext, docCells)
        const newPosition = nextCell.codeRange?.start ?? nextCell.cellRange.start
        repl.validateMoveAndReveal(editor, newPosition, newPosition)
    }

    /** Move the specified cell, or the cell or cells intersecting with the current selections */
    private moveCell(
        direction: 'down' | 'up',
        cell?: JuliaCell,
        docCells: readonly JuliaCell[] = this.getDocCells()
    ): boolean {
        telemetry.traceEvent('command-moveCell')
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
            : this.getSelectionsCellContext(docCells)
        this._moveCell(editor, cellContext, direction, docCells)
        return true
    }

    /** Select the specified cell, or the cell intersecting with the current active selection */
    private selectCell(cell?: JuliaCell, docCells: readonly JuliaCell[] = this.getDocCells()): void {
        telemetry.traceEvent('command-selectCell')
        const editor = vscode.window.activeTextEditor
        if (editor === undefined) {
            return
        }
        const selections = [new vscode.Selection(editor.selection.active, editor.selection.active)]
        cell ??= this.getSelectionsCellContext(docCells, selections).current[0]
        const start_pos = cell.codeRange?.start ?? cell.cellRange.start
        const end_pos = cell.codeRange?.end ?? cell.cellRange.end
        repl.validateMoveAndReveal(editor, start_pos, end_pos)
    }

    private async _commandCommonSave(editor: vscode.TextEditor): Promise<boolean> {
        if (editor === undefined) {
            return false
        }
        if (this.shouldSaveOnEval) {
            await editor.document.save()
        }
        return true
    }

    private async _executeCells(editor: vscode.TextEditor, cells: readonly JuliaCell[]): Promise<boolean> {
        const document = editor.document
        const codeRanges: vscode.Range[] = cells.map((cell) => cell.codeRange).filter((cr) => cr !== undefined)
        const cellPendings: results.Result[] = codeRanges.map((codeRange) =>
            results.addResult(editor, codeRange, this.PENDING_SIGN, '')
        )
        const isInline = this.inlineResultsForCellEvaluation
        const { module } = await modules.getModuleForEditor(document, codeRanges[0].start)
        await repl.startREPL(true, false)
        for (const codeRange of codeRanges) {
            cellPendings.shift().remove(true)
            const code = document.getText(codeRange)
            if (isInline) {
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

    /** Execute the specified cell, or the cell or cells intersecting with the current selections in document order */
    private async executeCell(cell?: JuliaCell): Promise<boolean> {
        telemetry.traceEvent('command-executeCell')
        const editor = vscode.window.activeTextEditor
        if ((await this._commandCommonSave(editor)) === false) {
            return false
        }
        let cells: JuliaCell[]
        if (cell !== undefined) {
            cells = [cell]
        } else {
            const cellContext = this.getSelectionsCellContext(this.getDocCells(editor.document))
            cells = cellContext.current
        }
        return await this._executeCells(editor, cells)
    }

    /** For each selection (in selection order), execute the selection if non-empty, otherwise execute the entire cell containing the selection */
    private async executeSelectionOrCell(
        shouldMove: boolean = false,
        docCells: readonly JuliaCell[] = this.getDocCells()
    ): Promise<void> {
        telemetry.traceEvent('command-executeSelectionOrCell')
        const editor = vscode.window.activeTextEditor
        if ((await this._commandCommonSave(editor)) === false) {
            return
        }
        for (const selection of editor.selections.slice()) {
            let cell: JuliaCell
            if (selection.isEmpty) {
                const cellContext = this.getSelectionsCellContext(docCells, [selection])
                if (cellContext.current.length === 0) {
                    continue
                }
                cell = cellContext.current[0]
            } else {
                const codeRange = new vscode.Range(selection.start, selection.end)
                cell = {
                    id: -1,
                    cellRange: codeRange,
                    codeRange: codeRange,
                }
            }
            await this._executeCells(editor, [cell])
        }
        const cellContext = this.getSelectionsCellContext(docCells, editor.selections)
        if (shouldMove) {
            this._moveCell(editor, cellContext, 'down', docCells)
        }
    }

    /** Execute the specified cell, or the cell or cells intersecting with the current selections, then move */
    private async executeCellAndMove(
        direction: 'down' | 'up',
        cell?: JuliaCell,
        docCells: readonly JuliaCell[] = this.getDocCells()
    ): Promise<boolean> {
        telemetry.traceEvent('command-executeCellAndMove')
        const editor = vscode.window.activeTextEditor
        if ((await this._commandCommonSave(editor)) === false) {
            return false
        }
        const cellContext = cell
            ? ({
                  inf: cell,
                  current: [cell],
                  sup: cell,
              } satisfies CellContext)
            : this.getSelectionsCellContext(docCells)
        this._moveCell(editor, cellContext, direction, docCells)
        if (cellContext.current.length === 0) {
            return false
        }
        return await this._executeCells(editor, cellContext.current)
    }

    /** Execute the current specified cell, or cells intersecting with the current selections, and all cells below */
    private async executeCurrentAndBelowCells(
        cell?: JuliaCell,
        docCells: readonly JuliaCell[] = this.getDocCells()
    ): Promise<boolean> {
        telemetry.traceEvent('command-executeCurrentAndBelowCells')
        const editor = vscode.window.activeTextEditor
        if ((await this._commandCommonSave(editor)) === false) {
            return false
        }
        let beginId: number
        if (cell !== undefined) {
            beginId = cell.id
        } else {
            const cellContext = this.getSelectionsCellContext(docCells)
            if (cellContext.current.length === 0) {
                beginId = cellContext.sup?.id ?? docCells.length
            } else {
                beginId = cellContext.current[0].id
            }
        }
        return await this._executeCells(editor, docCells.slice(beginId, docCells.length))
    }

    /** Execute all cells above the specified cell, or above the current selections */
    private async executeAboveCells(
        cell?: JuliaCell,
        docCells: readonly JuliaCell[] = this.getDocCells()
    ): Promise<boolean> {
        telemetry.traceEvent('command-executeAboveCells')
        const editor = vscode.window.activeTextEditor
        if ((await this._commandCommonSave(editor)) === false) {
            return false
        }
        let endId: number
        if (cell !== undefined) {
            endId = cell.id
        } else {
            const cellContext = this.getSelectionsCellContext(docCells)
            if (cellContext.current.length === 0) {
                endId = cellContext.inf?.id ?? 0
            } else {
                endId = cellContext.current[0].id
            }
        }
        return await this._executeCells(editor, docCells.slice(0, endId))
    }
}

export class CodeCellFeature
    extends CodeCellExecutionFeature
    implements vscode.CodeLensProvider, vscode.FoldingRangeProvider
{
    private readonly onDidChangeCodeLensConfiguration = new vscode.EventEmitter<void>()
    public readonly onDidChangeCodeLenses = anyEvent(
        this.onDidChangeCellDelimiters.event,
        this.onDidChangeCodeLensConfiguration.event
    )
    public readonly onDidChangeFoldingRanges = this.onDidChangeCellDelimiters.event

    private useCodeLens: boolean
    private useCellHighlighting: boolean

    private readonly decoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
        isWholeLine: true,
    })
    private readonly currentCellTop = vscode.window.createTextEditorDecorationType({
        borderColor: new vscode.ThemeColor('interactive.activeCodeBorder'),
        borderWidth: '1px 0px 0px 0px',
        borderStyle: 'solid',
        isWholeLine: true,
    })
    private readonly currentCellBottom = vscode.window.createTextEditorDecorationType({
        borderColor: new vscode.ThemeColor('interactive.activeCodeBorder'),
        borderWidth: '0px 0px 1px 0px',
        borderStyle: 'solid',
        isWholeLine: true,
    })

    constructor(context: vscode.ExtensionContext) {
        super(context)
        this.updateUseCodeLens()
        this.updateUseCellHighlighting()
        this.context.subscriptions.push(
            vscode.languages.registerCodeLensProvider(['julia', 'juliamarkdown'], this),
            vscode.window.onDidChangeTextEditorSelection(this.onDidChangeTextEditorSelection.bind(this))
        )
        // FoldingRange
        this.context.subscriptions.push(vscode.languages.registerFoldingRangeProvider(['julia', 'juliamarkdown'], this))
    }

    public override dispose() {
        super.dispose()
        this.decoration.dispose()
        this.currentCellTop.dispose()
        this.currentCellBottom.dispose()
    }

    private updateUseCodeLens() {
        this.useCodeLens = vscode.workspace.getConfiguration('julia').get<boolean>('useCodeLens', true)
    }

    private updateUseCellHighlighting() {
        this.useCellHighlighting = vscode.workspace.getConfiguration('julia').get<boolean>('useCellHighlighting', true)
    }

    protected override onDidChangeConfiguration(event: vscode.ConfigurationChangeEvent) {
        super.onDidChangeConfiguration(event)
        if (event.affectsConfiguration('julia.useCodeLens')) {
            this.updateUseCodeLens()
            this.onDidChangeCellDelimiters.fire()
        }
        if (event.affectsConfiguration('julia.useCellHighlighting')) {
            this.updateUseCellHighlighting()
            this.onDidChangeCellDelimiters.fire()
        }
    }

    public provideCodeLenses(
        document: vscode.TextDocument,
        // prettier-ignore
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.CodeLens[]> {
        const codeLenses: vscode.CodeLens[] = []
        const editor = vscode.window.activeTextEditor
        if (editor === undefined || editor.document !== document) {
            return codeLenses
        }
        if (!this.useCellHighlighting) {
            this.unhighlight(editor)
        }
        if (!this.useCodeLens) {
            return codeLenses
        }
        const docCells = this.getDocCells(document)
        if (docCells.length <= 1) {
            this.unhighlight(editor)
            return codeLenses
        }
        const selections = [new vscode.Selection(editor.selection.active, editor.selection.active)]
        this.highlight(editor, docCells, selections)

        for (const cell of docCells.slice()) {
            if (cell.codeRange === undefined) {
                continue
            }
            codeLenses.push(
                new vscode.CodeLens(cell.cellRange, {
                    title: 'Run Cell',
                    tooltip: 'Execute the cell in the Julia REPL',
                    command: 'language-julia.executeCell',
                    arguments: [cell, docCells],
                }),
                cell.id === 0
                    ? // The first cell would be skipped since it is preceded by a delimiter
                      new vscode.CodeLens(cell.cellRange, {
                          title: 'Run Below',
                          tooltip: 'Execute all cells below in the Julia REPL',
                          command: 'language-julia.executeCurrentAndBelowCells',
                          arguments: [cell, docCells],
                      })
                    : new vscode.CodeLens(cell.cellRange, {
                          title: 'Run Above',
                          tooltip: 'Execute all cells above in the Julia REPL',
                          command: 'language-julia.executeAboveCells',
                          arguments: [cell, docCells],
                      })
            )
        }
        return codeLenses
    }

    public provideFoldingRanges(
        document: vscode.TextDocument,
        // prettier-ignore
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        context: vscode.FoldingContext,
        // prettier-ignore
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.FoldingRange[]> {
        const docCells = this.getDocCells(document)
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

    private onDidChangeTextEditorSelection(event: vscode.TextEditorSelectionChangeEvent): void {
        const editor = event.textEditor
        const document = editor.document
        if (!this.isJuliaDocument(document)) {
            return
        }
        const docCells = this.getDocCells(document)
        if (docCells.length <= 1) {
            return
        }
        const selections = [new vscode.Selection(event.selections[0].active, event.selections[0].active)]
        this.highlight(editor, docCells, selections)
    }

    private highlightCells(editor: vscode.TextEditor, docCells: readonly JuliaCell[]): void {
        const cellRanges = docCells.map((cell) => cell.cellRange).slice(1)
        editor.setDecorations(this.decoration, cellRanges)
    }

    private highlightCurrentCell(editor: vscode.TextEditor, cellContext: CellContext): void {
        const cells = cellContext.current
        if (cells.length !== 1) {
            return
        }
        const cell = cells[0]
        editor.setDecorations(this.currentCellTop, [new vscode.Range(cell.cellRange.start, cell.cellRange.start)])
        editor.setDecorations(this.currentCellBottom, [new vscode.Range(cell.cellRange.end, cell.cellRange.end)])
    }

    private highlight(
        editor: vscode.TextEditor,
        docCells: readonly JuliaCell[],
        selections?: readonly vscode.Selection[]
    ): void {
        if (!this.useCellHighlighting) {
            return
        }
        if (this.isJmdDocument(editor.document)) {
            this.highlightCells(editor, docCells)
        }
        if (selections !== undefined) {
            const cellContext = this.getSelectionsCellContext(docCells, selections)
            this.highlightCurrentCell(editor, cellContext)
        }
    }

    private unhighlight(editor: vscode.TextEditor): void {
        editor.setDecorations(this.decoration, [])
        editor.setDecorations(this.currentCellTop, [])
        editor.setDecorations(this.currentCellBottom, [])
    }
}
