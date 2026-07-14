// provides completions and signature helps using dynamic information

import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc'
import { Disposable, MessageConnection } from 'vscode-jsonrpc'
import { handleNewCrashReportFromException } from '../telemetry'
import { wrapCrashReporting } from '../utils'
import { getModuleForEditor } from './modules'
import { onExit, onInit } from './repl'

const selector = [
    { language: 'julia', scheme: 'untitled' },
    { language: 'julia', scheme: 'file' },
]
const completionTriggerCharacters = [
    '.', // property/field completion
    '[', // dict completion
]
export function activate(context: vscode.ExtensionContext) {
    let completionSubscription: undefined | Disposable = undefined
    context.subscriptions.push(
        onInit(
            wrapCrashReporting(({ connection: conn }) => {
                completionSubscription = vscode.languages.registerCompletionItemProvider(
                    selector,
                    completionItemProvider(conn),
                    ...completionTriggerCharacters
                )
            })
        ),
        onExit(() => {
            if (completionSubscription) {
                completionSubscription.dispose()
            }
        })
    )
}

const requestTypeGetCompletionItems = new rpc.RequestType<
    { line: string; mod: string }, // input type
    (vscode.CompletionItem & { prefixLength?: number })[], // return type
    void
>('repl/getcompletions')

/**
 * Set an explicit replacement range on a completion item. `prefixLength` is the
 * length (in UTF-16 code units) of the typed text before the cursor that the
 * completion replaces, as reported by REPLCompletions. Without this, VS Code
 * guesses a word range, which breaks e.g. `x.var"he` → `x.var"var"hello world"`
 * (julia-vscode#3867).
 */
function setCompletionItemRange(
    item: vscode.CompletionItem & { prefixLength?: number },
    document: vscode.TextDocument,
    position: vscode.Position
) {
    const prefixLength = item.prefixLength
    if (typeof prefixLength !== 'number' || prefixLength < 0 || prefixLength > position.character) {
        return item
    }
    const start = position.translate(0, -prefixLength)
    let end = position
    // If the completion closes a string the user is still typing (e.g. the
    // replaced `var"he` has an unterminated quote) and the editor auto-closed
    // it, the quote right after the cursor would end up duplicated — include
    // it in the replaced range.
    const label = typeof item.label === 'string' ? item.label : item.label.label
    const replaced = document.getText(new vscode.Range(start, position))
    const quoteCount = (replaced.match(/"/g) ?? []).length
    if (
        quoteCount % 2 === 1 &&
        label.endsWith('"') &&
        document.getText(new vscode.Range(position, position.translate(0, 1))) === '"'
    ) {
        end = position.translate(0, 1)
    }
    item.range = new vscode.Range(start, end)
    return item
}

function completionItemProvider(conn: MessageConnection): vscode.CompletionItemProvider {
    return {
        provideCompletionItems: async (document, position, token) => {
            if (!vscode.workspace.getConfiguration('julia').get('runtimeCompletions')) {
                return
            }
            const completionPromise = (async () => {
                try {
                    const startPosition = new vscode.Position(position.line, 0)
                    const lineRange = new vscode.Range(startPosition, position)
                    const line = document.getText(lineRange)

                    const { module } = await getModuleForEditor(document, position)
                    if (token.isCancellationRequested) {
                        return
                    }

                    const items = await conn.sendRequest(requestTypeGetCompletionItems, { line, mod: module })
                    if (token.isCancellationRequested) {
                        return
                    }

                    return {
                        items: items.map((item) => setCompletionItemRange(item, document, position)),
                        isIncomplete: true,
                    }
                } catch (err) {
                    handleNewCrashReportFromException(err, 'Extension')
                    throw err
                }
            })()

            const cancelPromise: Promise<vscode.CompletionList> = new Promise((resolve) => {
                token.onCancellationRequested(() =>
                    resolve({
                        items: [],
                        isIncomplete: true,
                    })
                )
                setTimeout(() => {
                    if (!token.isCancellationRequested) {
                        resolve({
                            items: [],
                            isIncomplete: true,
                        })
                    }
                }, 500)
            })

            return Promise.race([completionPromise, cancelPromise])
        },
    }
}
