import * as vscode from 'vscode'
import { constructCommandString, registerCommand, setContext } from '../utils'

const LINE_INF = 9999

export enum GlyphChars {
    MuchLessThan = '\u226A',
    LessThan = '\u003C',
    GreaterThan = '\u003E',
    MuchGreaterThan = '\u226B',
    BallotX = '\u2717',
}

export enum ResultType {
    Error,
    Result,
}

interface ResultContent {
    isIcon: boolean
    content: string
    hoverContent: string | vscode.MarkdownString
    isError: boolean
    type: ResultType
}

export class Result {
    document: vscode.TextDocument
    text: string
    range: vscode.Range
    content: ResultContent
    decoration: vscode.TextEditorDecorationType
    destroyed: boolean
    removeEmitter: vscode.EventEmitter<undefined>
    onDidRemove: vscode.Event<undefined>

    constructor(editor: vscode.TextEditor, range: vscode.Range, content: ResultContent) {
        this.range = range
        this.document = editor.document
        this.text = editor.document.getText(this.range)
        this.destroyed = false
        this.removeEmitter = new vscode.EventEmitter()
        this.onDidRemove = this.removeEmitter.event

        this.setContent(content)
        for (const selection of editor.selections) {
            if (isResultInLineRange(editor, this, selection)) {
                setContext('julia.hasInlineResult', true)
            }
        }
    }

    setContent(content: ResultContent) {
        if (this.destroyed) {
            return
        }

        this.content = content

        if (this.decoration) {
            this.remove()
        }

        const decoration = this.createDecoration()

        if (content.isIcon) {
            decoration.before.contentIconPath = content.content
        } else if (decoration.before) {
            decoration.before.contentText = content.content
        }

        this.decoration = vscode.window.createTextEditorDecorationType(decoration)

        for (const ed of vscode.window.visibleTextEditors) {
            if (ed.document === this.document) {
                ed.setDecorations(this.decoration, [
                    {
                        hoverMessage: this.content.hoverContent,
                        range: this.decorationRange,
                    },
                ])
            }
        }
    }

    createDecoration(): vscode.DecorationRenderOptions {
        if (this.content.type === ResultType.Error) {
            return this.createErrorDecoration()
        } else {
            return this.createResultDecoration()
        }
    }

    createResultDecoration(): vscode.DecorationRenderOptions {
        const accentColor = this.content.isError
            ? new vscode.ThemeColor('julia.result.error')
            : new vscode.ThemeColor('julia.result.success')

        return {
            before: {
                contentIconPath: undefined,
                contentText: undefined,
                color: new vscode.ThemeColor('julia.result.foreground'),
                backgroundColor: new vscode.ThemeColor('julia.result.background'),
                margin: '0 0 0 10px',
                border: '2px solid',
                borderColor: accentColor,
                // HACK: CSS injection to get custom styling in:
                textDecoration:
                    'none; white-space: pre; border-top: 0px; border-right: 0px; border-bottom: 0px; border-radius: 2px',
            },
            rangeBehavior: vscode.DecorationRangeBehavior.OpenClosed,
        }
    }

    createErrorDecoration(): vscode.DecorationRenderOptions {
        return {
            backgroundColor: new vscode.ThemeColor('diffEditor.removedTextBackground'),
            isWholeLine: true,
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        }
    }

    get decorationRange(): vscode.Range {
        return this.content.type === ResultType.Error
            ? this.range
            : new vscode.Range(this.range.end.translate(0, LINE_INF), this.range.end.translate(0, LINE_INF))
    }

    draw() {
        this.setContent(this.content)
    }

    validate(e: vscode.TextDocumentChangeEvent) {
        if (this.document !== e.document) {
            return true
        }

        for (const change of e.contentChanges) {
            const intersect = change.range.intersection(this.range)
            if (
                intersect !== undefined &&
                !((intersect.isEmpty && change.text === '\n') || change.text === '\r\n' || change.text === '')
            ) {
                return false
            }

            if (
                change.range.end.line < this.range.start.line ||
                (change.range.end.line === this.range.start.line &&
                    change.range.end.character <= this.range.start.character)
            ) {
                const lines = change.text.split('\n')

                const lineOffset = lines.length - 1 - (change.range.end.line - change.range.start.line)
                const charOffset = change.range.end.line === this.range.start.line ? lines[lines.length - 1].length : 0

                this.range = new vscode.Range(
                    this.range.start.translate(lineOffset, charOffset),
                    this.range.end.translate(lineOffset, charOffset)
                )
            }
        }

        if (this.document.getText(this.range) !== this.text) {
            return false
        }

        return true
    }

    remove(destroy: boolean = false) {
        this.destroyed = destroy
        this.decoration.dispose()
        if (destroy) {
            this.removeEmitter.fire(undefined)
            this.removeEmitter.dispose()
        }
    }
}

const results: Result[] = []
const supportedLanguageIds = ['julia', 'juliamarkdown', 'markdown']

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        // subscriptions
        vscode.workspace.onDidChangeTextDocument((e) => validateResults(e)),
        vscode.window.onDidChangeVisibleTextEditors((editors) => refreshResults(editors)),
        vscode.window.onDidChangeTextEditorSelection((changeEvent) =>
            updateContextKeyForSelections(changeEvent.textEditor, changeEvent.selections)
        ),

        // public commands
        registerCommand('language-julia.clearAllInlineResults', removeAll),
        registerCommand('language-julia.clearAllInlineResultsInEditor', () =>
            removeAll(vscode.window.activeTextEditor)
        ),
        registerCommand('language-julia.clearCurrentInlineResult', () => {
            if (vscode.window.activeTextEditor) {
                removeCurrent(vscode.window.activeTextEditor)
            }
        }),

        // internal commands
        registerCommand('language-julia.openFile', (locationArg: { path: string; line: number }) => {
            openFile(locationArg.path, locationArg.line)
        }),
        registerCommand('language-julia.gotoFirstFrame', gotoFirstFrame),
        registerCommand('language-julia.gotoPreviousFrame', (frameArg: { frame: Frame }) => {
            gotoPreviousFrame(frameArg.frame)
        }),
        registerCommand('language-julia.gotoNextFrame', (frameArg: { frame: Frame }) => {
            gotoNextFrame(frameArg.frame)
        }),
        registerCommand('language-julia.gotoLastFrame', gotoLastFrame),
        registerCommand('language-julia.clearStackTrace', clearStackTrace)
    )
    setContext('julia.supportedLanguageIds', supportedLanguageIds)
}

function updateContextKeyForSelections(
    editor: vscode.TextEditor,
    selections: readonly vscode.Selection[] = editor.selections
) {
    if (!supportedLanguageIds.includes(editor.document.languageId)) {
        return
    }
    for (const selection of selections) {
        for (const r of results) {
            if (isResultInLineRange(editor, r, selection)) {
                setContext('julia.hasInlineResult', true)
                return
            }
        }
    }
    setContext('julia.hasInlineResult', false)
}

export function deactivate() {}

export function addResult(editor: vscode.TextEditor, range: vscode.Range, content: string, hoverContent: string) {
    results
        .filter((result) => result.document === editor.document && result.range.intersection(range) !== undefined)
        .forEach(removeResult)
    const result = new Result(editor, range, resultContent(content, hoverContent))
    results.push(result)
    return result
}

export function resultContent(content: string, hoverContent: string, isError: boolean = false): ResultContent {
    return {
        isIcon: false,
        content,
        hoverContent: toMarkdownString(hoverContent),
        type: ResultType.Result,
        isError,
    }
}

function toMarkdownString(str: string) {
    const markdownString = new vscode.MarkdownString(str)
    markdownString.isTrusted = true
    return markdownString
}

export interface Frame {
    path: string
    line: number
    msg?: string
}
interface Highlight {
    frame: Frame
    result: undefined | Result
}

interface StackFrameHighlights {
    highlights: Highlight[]
    err: string
}

const stackFrameHighlights: StackFrameHighlights = { highlights: [], err: '' }

export function setStackTrace(result: Result, err: string, frames: Frame[]) {
    clearStackTrace()
    setStackFrameHighlight(err, frames)

    result.onDidRemove(() => clearStackTrace())
}

export function clearStackTrace() {
    stackFrameHighlights.highlights.forEach((highlight) => {
        if (highlight.result) {
            highlight.result.remove()
        }
    })
    stackFrameHighlights.highlights = []
    stackFrameHighlights.err = ''
}

export function setStackFrameHighlight(
    err: string,
    frames: Frame[],
    editors: readonly vscode.TextEditor[] = vscode.window.visibleTextEditors
) {
    stackFrameHighlights.err = err
    frames.forEach((frame) => {
        const targetEditors = editors.filter((editor) => isEditorPath(editor, frame.path))
        if (targetEditors.length === 0) {
            stackFrameHighlights.highlights.push({ frame, result: undefined })
        } else {
            targetEditors.forEach((targetEditor) => {
                const result = addErrorResult(frame.msg || err, frame, targetEditor)
                if (result) {
                    stackFrameHighlights.highlights.push({ frame, result })
                }
            })
        }
    })
}

function isEditorPath(editor: vscode.TextEditor, path: string) {
    return (
        // for untitled editor we need this
        editor.document.fileName === path ||
        // more robust than using e.g. `editor.document.fileName`
        editor.document.uri.toString() === vscode.Uri.file(path).toString()
    )
}

function addErrorResult(err: string, frame: Frame, editor: vscode.TextEditor) {
    if (frame.line > 0) {
        const range = new vscode.Range(
            editor.document.validatePosition(new vscode.Position(frame.line - 1, 0)),
            editor.document.validatePosition(new vscode.Position(frame.line - 1, LINE_INF))
        )
        return new Result(editor, range, errorResultContent(err, frame))
    }
    return null
}

function errorResultContent(err: string, frame: Frame): ResultContent {
    const transformed = attachGotoFrameCommandLinks(err, frame)
    return {
        content: '',
        isIcon: false,
        hoverContent: toMarkdownString(transformed),
        type: ResultType.Error,
        isError: true,
    }
}

function attachGotoFrameCommandLinks(transformed: string, frame: Frame) {
    return [
        `[\`${GlyphChars.MuchLessThan}\`](${constructCommandString('language-julia.gotoFirstFrame')} "Goto First Frame")`,
        `[\`${GlyphChars.LessThan}\`](${constructCommandString('language-julia.gotoPreviousFrame', { frame })} "Goto Previous Frame")`,
        `[\`${GlyphChars.GreaterThan}\`](${constructCommandString('language-julia.gotoNextFrame', { frame })} "Goto Next Frame")`,
        `[\`${GlyphChars.MuchGreaterThan}\`](${constructCommandString('language-julia.gotoLastFrame')} "Goto Last Frame")`,
        `[\`${GlyphChars.BallotX}\`](${constructCommandString('language-julia.clearStackTrace')} "Clear Stack Traces")`,
        `\n${transformed}`,
    ].join(' ')
}

export function refreshResults(editors: readonly vscode.TextEditor[]) {
    results.forEach((result) => {
        editors.forEach((editor) => {
            if (result.document === editor.document) {
                result.draw()
            }
        })
    })
    stackFrameHighlights.highlights.forEach((highlight) => {
        const frame = highlight.frame
        editors.forEach((editor) => {
            if (isEditorPath(editor, frame.path)) {
                if (highlight.result) {
                    highlight.result.draw()
                } else {
                    const result = addErrorResult(frame.msg || stackFrameHighlights.err, frame, editor)
                    if (result) {
                        highlight.result = result
                    }
                }
            }
        })
    })
}

export function validateResults(e: vscode.TextDocumentChangeEvent) {
    results.filter((result) => !result.validate(e)).forEach(removeResult)
}

export function removeResult(target: Result) {
    target.remove(true)
    return results.splice(results.indexOf(target), 1)
}

export function removeAll(editor: undefined | vscode.TextEditor = undefined) {
    const isvalid = (result: Result) => !editor || result.document === editor.document
    results.filter(isvalid).forEach(removeResult)
    clearStackTrace()
}

export function removeCurrent(editor: vscode.TextEditor) {
    editor.selections.forEach((selection) => {
        results.filter((r) => isResultInLineRange(editor, r, selection)).forEach(removeResult)
    })
    setContext('julia.hasInlineResult', false)
}

function isResultInLineRange(editor: vscode.TextEditor, result: Result, range: vscode.Selection | vscode.Range) {
    if (result.document !== editor.document) {
        return false
    }
    const intersect = range.intersection(result.range)
    const lineRange = new vscode.Range(
        range.start.with(undefined, 0),
        editor.document.validatePosition(range.start.with(undefined, LINE_INF))
    )
    const lineIntersect = lineRange.intersection(result.range)
    return intersect !== undefined || lineIntersect !== undefined
}

// goto frame utilties

export async function openFile(
    path: string,
    line: number | undefined = undefined,
    column: vscode.ViewColumn | undefined = undefined,
    preserveFocus: boolean | undefined = undefined
) {
    const newLine = line || 1
    const start = new vscode.Position(newLine - 1, 0)
    const end = new vscode.Position(newLine - 1, 0)
    const range = new vscode.Range(start, end)

    let uri: vscode.Uri
    if (path.indexOf('Untitled') === 0) {
        // can't open an untitled file like this:
        // uri = vscode.Uri.parse('untitled:' + path)
    } else {
        uri = vscode.Uri.file(path)
    }
    return vscode.window.showTextDocument(uri, {
        preserveFocus: preserveFocus,
        preview: true,
        selection: range,
        viewColumn: column,
    })
}

function gotoFirstFrame() {
    return gotoFrame(stackFrameHighlights.highlights[0].frame)
}

function gotoPreviousFrame(frame: Frame) {
    const i = findFrameIndex(frame)
    if (i < 1) {
        return
    }
    return gotoFrame(stackFrameHighlights.highlights[i - 1].frame)
}

function gotoNextFrame(frame: Frame) {
    const i = findFrameIndex(frame)
    if (i === -1 || i >= stackFrameHighlights.highlights.length - 1) {
        return
    }
    return gotoFrame(stackFrameHighlights.highlights[i + 1].frame)
}

function gotoLastFrame() {
    return gotoFrame(stackFrameHighlights.highlights[stackFrameHighlights.highlights.length - 1].frame)
}

function findFrameIndex(frame: Frame) {
    return stackFrameHighlights.highlights.findIndex((highlight) => {
        return highlight.frame.path === frame.path && highlight.frame.line === frame.line
    })
}

function gotoFrame(frame: Frame) {
    return openFile(frame.path, frame.line)
}
