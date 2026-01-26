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
    vscode.CompletionItem[], // return type
    void
>('repl/getcompletions')

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
                        items: items,
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
