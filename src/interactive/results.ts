import * as vscode from 'vscode'

const LINE_INF = 9999

export enum GlyphChars {
    MuchLessThan = '\u226A',
    LessThan = '\u003C',
    GreaterThan = '\u003E',
    MuchGreaterThan = '\u226B',
    BallotX = '\u2717'
}

interface ResultContent {
    isIcon: boolean,
    content: string,
    hoverContent: string | vscode.MarkdownString,
    isError: boolean
}

export class Result {
    document: vscode.TextDocument
    text: string
    range: vscode.Range
    content: ResultContent
    decoration: vscode.TextEditorDecorationType
    destroyed: boolean
    removeEmitter: vscode.EventEmitter<null>
    onDidRemove: vscode.Event<null>

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
        if (this.content.isError) {
            return this.createErrorDecoration()
        } else {
            return this.createResultDecoration()
        }
    }

    createResultDecoration(): vscode.DecorationRenderOptions {
        return {
            before: {
                contentIconPath: undefined,
                contentText: undefined,
                backgroundColor: new vscode.ThemeColor('editorWidget.background'),
                margin: '0 0 0 10px',
                color: new vscode.ThemeColor('editor.foreground'),
            },
            rangeBehavior: vscode.DecorationRangeBehavior.OpenClosed,
        }
    }

    createErrorDecoration(): vscode.DecorationRenderOptions {
        return {
            // there doesn't seem to be a color that looks nicely on any color themes ...
            backgroundColor: new vscode.ThemeColor('inputValidation.errorBackground'),
            borderColor: new vscode.ThemeColor('inputValidation.errorBorder'),
            isWholeLine: true,
            rangeBehavior: vscode.DecorationRangeBehavior.OpenClosed,
        }
    }

    get decorationRange(): vscode.Range {
        return this.content.isError ? this.range :
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
            this.removeEmitter.fire(null)
            this.removeEmitter.dispose()
        }
    }
}

const results: Result[] = []

export function activate(context) {
    context.subscriptions.push(
        // subscriptions
        vscode.workspace.onDidChangeTextDocument((e) => validateResults(e)),
        vscode.window.onDidChangeVisibleTextEditors((editors) => refreshResults(editors)),

        // public commands
        vscode.commands.registerCommand('language-julia.clearAllInlineResults', removeAll),
        vscode.commands.registerCommand('language-julia.clearAllInlineResultsInEditor', () => removeAll(vscode.window.activeTextEditor)),
        vscode.commands.registerCommand('language-julia.clearCurrentInlineResult', () => removeCurrent(vscode.window.activeTextEditor)),

        // internal commands
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

export function deactivate() { }

export function addResult(editor: vscode.TextEditor, range: vscode.Range, content: ResultContent) {
    results.filter(result => result.document === editor.document && result.range.intersection(range) !== undefined).forEach(removeResult)

    const result = new Result(editor, range, content)
    results.push(result)

    return result
}

export interface Frame {
    path: string,
    line: number
}
interface Highlight {
    frame: Frame,
    result: null | Result
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
        const targetEditors = editors.filter(editor => frame.path === editor.document.fileName)
        if (targetEditors.length === 0) {
            stackFrameHighlights.highlights.push({ frame, result: null })
        } else {
            targetEditors.forEach(targetEditor => {
                const result = addErrorResult(err, frame, targetEditor)
                stackFrameHighlights.highlights.push({ frame, result })
            })
        }
    })
}

function addErrorResult(err: string, frame: Frame, editor: vscode.TextEditor) {
    const resultContent = {
        content: '',
        isIcon: false,
        hoverContent: commandString(err, frame),
        isError: true
    }
    const range = new vscode.Range(new vscode.Position(frame.line - 1, 0), new vscode.Position(frame.line - 1, LINE_INF))
    return new Result(editor, range, resultContent)
}

function commandString(err: string, frame: Frame) {
    const frameArg = encodeURIComponent(JSON.stringify({ frame }))
    const gotoFirstFrameCommand = vscode.Uri.parse(`command:language-julia.gotoFirstFrame`)
    const gotoPreviousFrameCommand = vscode.Uri.parse(`command:language-julia.gotoPreviousFrame?${frameArg}`)
    const gotoNextFrameCommand = vscode.Uri.parse(`command:language-julia.gotoNextFrame?${frameArg}`)
    const gotoLastFrameCommand = vscode.Uri.parse(`command:language-julia.gotoLastFrame`)
    const clearStackTraceCommand = vscode.Uri.parse(`command:language-julia.clearStackTrace`)
    const content = [
        `[\`${GlyphChars.MuchLessThan}\`](${gotoFirstFrameCommand} "Goto First Frame")`,
        `[\`${GlyphChars.LessThan}\`](${gotoPreviousFrameCommand} "Goto Previous Frame")`,
        `[\`${GlyphChars.GreaterThan}\`](${gotoNextFrameCommand} "Goto Next Frame")`,
        `[\`${GlyphChars.MuchGreaterThan}\`](${gotoLastFrameCommand} "Goto Last Frame")`,
        `[\`${GlyphChars.BallotX}\`](${clearStackTraceCommand} "Clear Stack Traces")`,
        `\n${err}`
    ].join(' ')
    const hoverContent = new vscode.MarkdownString(content)
    hoverContent.isTrusted = true // for inline commands
    return hoverContent
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
            if (frame.path === editor.document.fileName) {
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

export function removeAll(editor: vscode.TextEditor | null = null) {
    const isvalid = (result: Result) => editor === null || result.document === editor.document
    results.filter(isvalid).forEach(removeResult)
}

export function removeCurrent(editor: vscode.TextEditor) {
    editor.selections.forEach(selection => {
        const isvalid = (result: Result) => {
            const intersect = selection.intersection(result.range)
            return result.document === editor.document && intersect !== undefined
        }
        results.filter(isvalid).forEach(removeResult)
    })
}

// goto frame utilties

function gotoFirstFrame() {
    gotoFrame(stackFrameHighlights.highlights[0].frame)
}

function gotoPreviousFrame(frame: Frame) {
    const i = findFrameIndex(frame)
    if (i < 1) {return}
    gotoFrame(stackFrameHighlights.highlights[i-1].frame)
}

function gotoNextFrame(frame: Frame) {
    const i = findFrameIndex(frame)
    if (i === -1 || i >= stackFrameHighlights.highlights.length - 1) {return}
    gotoFrame(stackFrameHighlights.highlights[i + 1].frame)
}

function gotoLastFrame() {
    gotoFrame(stackFrameHighlights.highlights[stackFrameHighlights.highlights.length-1].frame)
}

function findFrameIndex(frame: Frame) {
    return stackFrameHighlights.highlights.findIndex(highlight => {
        return highlight.frame.path === frame.path && highlight.frame.line === frame.line
    })
}

async function gotoFrame(frame: Frame) {
    const start = new vscode.Position(frame.line - 1, 0)
    const end = new vscode.Position(frame.line - 1, 0)
    const range = new vscode.Range(start, end)
    const uri = vscode.Uri.file(frame.path)
    const document = await vscode.workspace.openTextDocument(uri)
    return vscode.window.showTextDocument(document, {
        preview: true,
        selection: range,
    })
}
