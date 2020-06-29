import * as vscode from 'vscode'
import { setContext } from '../utils'

const LINE_INF = 9999

export enum GlyphChars {
    MuchLessThan = '\u226A',
    LessThan = '\u003C',
    GreaterThan = '\u003E',
    MuchGreaterThan = '\u226B',
    BallotX = '\u2717'
}

export enum ResultType {
    Error,
    Result
}

interface ResultContent {
    isIcon: boolean,
    content: string,
    hoverContent: string | vscode.MarkdownString,
    isError: boolean,
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
                ed.setDecorations(this.decoration, [{
                    hoverMessage: this.content.hoverContent,
                    range: this.decorationRange
                }])
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

        const borderColor = this.content.isError ? '#d11111' : '#159eed'
        return {
            before: {
                contentIconPath: undefined,
                contentText: undefined,
                color: new vscode.ThemeColor('editor.foreground'),
                backgroundColor: '#ffffff22',
                margin: '0 0 0 10px',
                // HACK: CSS injection to get custom styling in:
                textDecoration: `none; white-space: pre; border-left: 2px ${borderColor} solid; border-radius: 2px`
            },
            dark: {
                before: {
                    backgroundColor: '#ffffff22'
                }
            },
            light: {
                before: {
                    backgroundColor: '#00000011'
                }
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
        return this.content.type === ResultType.Error ? this.range :
            new vscode.Range(this.range.end.translate(0, LINE_INF), this.range.end.translate(0, LINE_INF))
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
            if (intersect !== undefined && !(intersect.isEmpty && change.text === '\n')) {
                return false
            }

            if (change.range.end.line < this.range.start.line ||
                (change.range.end.line === this.range.start.line &&
                    change.range.end.character <= this.range.start.character)) {
                const lines = change.text.split('\n')

                const lineOffset = lines.length - 1 - (change.range.end.line - change.range.start.line)
                const charOffset = change.range.end.line === this.range.start.line ?
                    lines[lines.length - 1].length : 0

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

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        // subscriptions
        vscode.workspace.onDidChangeTextDocument((e) => validateResults(e)),
        vscode.window.onDidChangeVisibleTextEditors((editors) => refreshResults(editors)),
        vscode.window.onDidChangeTextEditorSelection(changeEvent => updateResultContextKey(changeEvent)),

        // public commands
        vscode.commands.registerCommand('language-julia.clearAllInlineResults', removeAll),
        vscode.commands.registerCommand('language-julia.clearAllInlineResultsInEditor', () => removeAll(vscode.window.activeTextEditor)),
        vscode.commands.registerCommand('language-julia.clearCurrentInlineResult', () => removeCurrent(vscode.window.activeTextEditor)),

        // internal commands
        vscode.commands.registerCommand('language-julia.openFile', (locationArg: { path: string, line: number }) => {
            openFile(locationArg.path, locationArg.line)
        }),
        vscode.commands.registerCommand('language-julia.gotoFirstFrame', gotoFirstFrame),
        vscode.commands.registerCommand('language-julia.gotoPreviousFrame', (frameArg: { frame: Frame }) => {
            gotoPreviousFrame(frameArg.frame)
        }),
        vscode.commands.registerCommand('language-julia.gotoNextFrame', (frameArg: { frame: Frame }) => {
            gotoNextFrame(frameArg.frame)
        }),
        vscode.commands.registerCommand('language-julia.gotoLastFrame', gotoLastFrame),
        vscode.commands.registerCommand('language-julia.clearStackTrace', clearStackTrace)
    )
}

function updateResultContextKey(changeEvent: vscode.TextEditorSelectionChangeEvent) {
    if (changeEvent.textEditor.document.languageId !== 'julia') {
        return
    }
    for (const selection of changeEvent.selections) {
        for (const r of results) {
            if (isResultInLineRange(changeEvent.textEditor, r, selection)) {
                setContext('juliaHasInlineResult', true)
                return
            }
        }
    }
    setContext('juliaHasInlineResult', false)
}


export function deactivate() { }

export function addResult(
    editor: vscode.TextEditor,
    range: vscode.Range,
    content: string,
    hoverContent: string
) {
    results.filter(result => result.document === editor.document && result.range.intersection(range) !== undefined).forEach(removeResult)
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
        isError
    }
}

const commandString = (cmd: string, args: string = '') => `command:${cmd}?${encodeURIComponent(args)}`

function toMarkdownString(str: string) {
    const markdownString = new vscode.MarkdownString(str)
    markdownString.isTrusted = true
    return markdownString
}

export interface Frame {
    path: string,
    line: number
}
interface Highlight {
    frame: Frame,
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
    stackFrameHighlights.highlights.forEach(highlight => {
        if (highlight.result) {
            highlight.result.remove()
        }
    })
    stackFrameHighlights.highlights = []
    stackFrameHighlights.err = ''
}

function setStackFrameHighlight(
    err: string,
    frames: Frame[],
    editors: vscode.TextEditor[] = vscode.window.visibleTextEditors
) {
    stackFrameHighlights.err = err
    frames.forEach(frame => {
        const targetEditors = editors.filter(editor => isEditorPath(editor, frame.path))
        if (targetEditors.length === 0) {
            stackFrameHighlights.highlights.push({ frame, result: undefined })
        } else {
            targetEditors.forEach(targetEditor => {
                const result = addErrorResult(err, frame, targetEditor)
                stackFrameHighlights.highlights.push({ frame, result })
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
    const range = new vscode.Range(new vscode.Position(frame.line - 1, 0), new vscode.Position(frame.line - 1, LINE_INF))
    return new Result(editor, range, errorResultContent(err, frame))
}

function errorResultContent(err: string, frame: Frame): ResultContent {
    const transformed = attachGotoFrameCommandLinks(err, frame)
    return {
        content: '',
        isIcon: false,
        hoverContent: toMarkdownString(transformed),
        type: ResultType.Error,
        isError: true
    }
}

function attachGotoFrameCommandLinks(transformed: string, frame: Frame) {
    const args = encodeURIComponent(JSON.stringify({ frame }))
    return [
        `[\`${GlyphChars.MuchLessThan}\`](${commandString('language-julia.gotoFirstFrame')} "Goto First Frame")`,
        `[\`${GlyphChars.LessThan}\`](${commandString('language-julia.gotoPreviousFrame', args)} "Goto Previous Frame")`,
        `[\`${GlyphChars.GreaterThan}\`](${commandString('language-julia.gotoNextFrame', args)} "Goto Next Frame")`,
        `[\`${GlyphChars.MuchGreaterThan}\`](${commandString('language-julia.gotoLastFrame')} "Goto Last Frame")`,
        `[\`${GlyphChars.BallotX}\`](${commandString('language-julia.clearStackTrace')} "Clear Stack Traces")`,
        `\n${transformed}`
    ].join(' ')
}

export function refreshResults(editors: vscode.TextEditor[]) {
    results.forEach(result => {
        editors.forEach(editor => {
            if (result.document === editor.document) {
                result.draw()
            }
        })
    })
    stackFrameHighlights.highlights.forEach(highlight => {
        const frame = highlight.frame
        editors.forEach(editor => {
            if (isEditorPath(editor, frame.path)) {
                if (highlight.result) {
                    highlight.result.draw()
                } else {
                    highlight.result = addErrorResult(stackFrameHighlights.err, frame, editor)
                }
            }
        })
    })
}

export function validateResults(e: vscode.TextDocumentChangeEvent) {
    results.filter(result => !result.validate(e)).forEach(removeResult)
}

export function removeResult(target: Result) {
    target.remove(true)
    return results.splice(results.indexOf(target), 1)
}

export function removeAll(editor: undefined | vscode.TextEditor = undefined) {
    const isvalid = (result: Result) => (!editor) || result.document === editor.document
    results.filter(isvalid).forEach(removeResult)
}

export function removeCurrent(editor: vscode.TextEditor) {
    editor.selections.forEach(selection => {
        results.filter(r => isResultInLineRange(editor, r, selection)).forEach(removeResult)
    })
    setContext('juliaHasInlineResult', false)
}

function isResultInLineRange(editor: vscode.TextEditor, result: Result, range: vscode.Selection | vscode.Range) {
    if (result.document !== editor.document) { return false }
    const intersect = range.intersection(result.range)
    const lineRange = new vscode.Range(range.start.with(undefined, 0), editor.document.validatePosition(range.start.with(undefined, LINE_INF)))
    const lineIntersect = lineRange.intersection(result.range)
    return intersect !== undefined || lineIntersect !== undefined
}

// goto frame utilties

async function openFile(path: string, line: number = undefined) {
    line = line || 1
    const start = new vscode.Position(line - 1, 0)
    const end = new vscode.Position(line - 1, 0)
    const range = new vscode.Range(start, end)

    let uri: vscode.Uri
    if (path.indexOf('Untitled') === 0) {
        // can't open an untitled file like this:
        // uri = vscode.Uri.parse('untitled:' + path)
    } else {
        uri = vscode.Uri.file(path)
    }
    return vscode.window.showTextDocument(uri, {
        preview: true,
        selection: range
    })
}

function gotoFirstFrame() {
    return gotoFrame(stackFrameHighlights.highlights[0].frame)
}

function gotoPreviousFrame(frame: Frame) {
    const i = findFrameIndex(frame)
    if (i < 1) { return }
    return gotoFrame(stackFrameHighlights.highlights[i - 1].frame)
}

function gotoNextFrame(frame: Frame) {
    const i = findFrameIndex(frame)
    if (i === -1 || i >= stackFrameHighlights.highlights.length - 1) { return }
    return gotoFrame(stackFrameHighlights.highlights[i + 1].frame)
}

function gotoLastFrame() {
    return gotoFrame(stackFrameHighlights.highlights[stackFrameHighlights.highlights.length - 1].frame)
}

function findFrameIndex(frame: Frame) {
    return stackFrameHighlights.highlights.findIndex(highlight => {
        return highlight.frame.path === frame.path && highlight.frame.line === frame.line
    })
}

const gotoFrame = (frame: Frame) => openFile(frame.path, frame.line)
