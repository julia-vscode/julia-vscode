// provides completions and signature helps using dynamic information

import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc'
import { Disposable, MessageConnection } from 'vscode-jsonrpc'
import { getModuleForEditor } from './modules'
import { onExit, onInit } from './repl'

function makeTimeout() {
    return new Promise<undefined>(resolve => {
        setTimeout(() => {
            return resolve(undefined)
        }, 1000)
    })
}

const selector = {
    language: 'julia'
}
const completionTriggerCharacters = [
    '\.', // property/field completion
    '[', // dict completion
]
const signatureHelpTriggerCharacters = ['(', ',']
const signatureHelpRetriggerCharacters = ['.']

export function activate(context: vscode.ExtensionContext) {
    let completionSubscription: undefined | Disposable = undefined
    let signatureHelpSubscription: undefined | Disposable = undefined
    context.subscriptions.push(
        onInit(conn => {
            completionSubscription = vscode.languages.registerCompletionItemProvider(
                selector,
                completionItemProvider(conn),
                ...completionTriggerCharacters
            )
            signatureHelpSubscription = vscode.languages.registerSignatureHelpProvider(
                selector,
                signatureHelpProvider(conn),
                {
                    triggerCharacters: signatureHelpTriggerCharacters,
                    retriggerCharacters: signatureHelpRetriggerCharacters
                }
            )
        }),
        onExit(hadError => {
            if (completionSubscription) { completionSubscription.dispose() }
            if (signatureHelpSubscription) { signatureHelpSubscription.dispose() }
        })
    )
}

const requestTypeGetCompletionItems = new rpc.RequestType<
    { line: string, mod: string }, // input type
    vscode.CompletionItem[], // return type
    void, void
>('repl/getcompletions')

// const requestTypeResolveCompletionItem = new rpc.RequestType<
//     vscode.CompletionItem, // input type
//     vscode.CompletionItem, // return type
//     void, void
// >('repl/resolvecompletion')

function completionItemProvider(conn: MessageConnection): vscode.CompletionItemProvider {
    return {
        provideCompletionItems: async (document, position, token, context) => {
            const startPosition = new vscode.Position(position.line, 0)
            const lineRange = new vscode.Range(startPosition, position)
            const line = document.getText(lineRange)
            const mod: string = await getModuleForEditor(document, position)
            return {
                items: await conn.sendRequest(requestTypeGetCompletionItems, { line, mod }),
                isIncomplete: true
            }
        },
        // resolveCompletionItem: (item, token) => {
        //     return undefined
        // }
    }
}

const requestTypeGetSignatureHelp = new rpc.RequestType<
    { sig: string, mod: string, context: vscode.SignatureHelpContext }, // input type
    vscode.SignatureHelp, // return type
    void, void
>('repl/getsignaturehelp')

// TODO: use LS for target signature range retrieval
function signatureHelpProvider(conn: MessageConnection): vscode.SignatureHelpProvider {
    return {
        provideSignatureHelp: async (document, position, token, context) => {
            const startPosition = new vscode.Position(position.line, 0)
            const lineRange = new vscode.Range(startPosition, position)
            const sig = document.getText(lineRange)
            const mod = await getModuleForEditor(document, position)
            return Promise.race([
                conn.sendRequest(requestTypeGetSignatureHelp, { sig, mod, context }),
                makeTimeout()
            ])
        },
    }
}
