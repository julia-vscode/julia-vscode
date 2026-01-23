import * as vscode from 'vscode'

function getHeaderDelimiters(): RegExp[] {
    const delims = vscode.workspace.getConfiguration('julia').get<string[]>('cellDelimiters') ?? []
    return delims.map((s) => RegExp(s))
}

function stripDelimiter(line: string, delims: RegExp[]): string | null {
    for (const regex of delims) {
        const match = line.match(regex)
        if (match && match.index === 0) {
            return line.slice(match[0].length)
        }
    }
    return null
}

function extractMarkdownHeader(line: string, delims: RegExp[]): { name: string; level: number } | null {
    const remainder = stripDelimiter(line, delims)
    if (remainder === null) {
        return null
    }
    const match = remainder.match(/^\s*(#+)\s+(.*)$/)
    if (!match) {
        return null
    }
    const level = match[1].length
    const name = match[2].trim()
    if (!name) {
        return null
    }
    return { name, level }
}

function collectMarkdownHeaders(doc: vscode.TextDocument): vscode.DocumentSymbol[] {
    const rootSymbols: vscode.DocumentSymbol[] = []
    const stack: Array<{ level: number; symbol: vscode.DocumentSymbol }> = []
    const delims = getHeaderDelimiters()

    for (let lineNum = 0; lineNum < doc.lineCount; lineNum++) {
        const lineText = doc.lineAt(lineNum).text

        const header = extractMarkdownHeader(lineText, delims)
        if (!header) {
            continue
        }

        let nextHeaderLine = doc.lineCount
        for (let i = lineNum + 1; i < doc.lineCount; i++) {
            if (extractMarkdownHeader(doc.lineAt(i).text, delims)) {
                nextHeaderLine = i
                break
            }
        }

        const lastContentLine = Math.max(lineNum, nextHeaderLine - 1)
        const lastContentChar = doc.lineAt(lastContentLine).text.length
        const range = new vscode.Range(lineNum, 0, lastContentLine, lastContentChar)
        const selectionRange = new vscode.Range(lineNum, 0, lineNum, lineText.length)
        const symbol = new vscode.DocumentSymbol(
            header.name,
            `Markdown H${header.level}`,
            vscode.SymbolKind.Namespace,
            range,
            selectionRange
        )

        while (stack.length > 0 && header.level <= stack[stack.length - 1].level) {
            stack.pop()
        }

        if (stack.length === 0) {
            rootSymbols.push(symbol)
        } else {
            stack[stack.length - 1].symbol.children.push(symbol)
        }

        stack.push({ level: header.level, symbol })
    }

    return rootSymbols
}

class MarkdownCellOutlineProvider implements vscode.DocumentSymbolProvider {
    async provideDocumentSymbols(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken
    ): Promise<vscode.DocumentSymbol[]> {
        const enabled = vscode.workspace.getConfiguration('julia').get<boolean>('outline.contents.enabled')
        if (!enabled) {
            return []
        }
        const contents = collectMarkdownHeaders(document)
        return contents
    }
}

export function activate(context: vscode.ExtensionContext): vscode.Disposable {
    const selector: vscode.DocumentSelector = [
        { language: 'julia', scheme: 'file' },
        { language: 'julia', scheme: 'untitled' },
    ]
    const provider = new MarkdownCellOutlineProvider()
    const disposable = vscode.languages.registerDocumentSymbolProvider(selector, provider, { label: 'Contents' })
    context.subscriptions.push(disposable)
    return disposable
}
