import * as assert from 'assert'
import * as vscode from 'vscode'
import { AbstractMessageReader, AbstractMessageWriter, DataCallback, Disposable, Message } from 'vscode-jsonrpc'
import { LanguageClient, MessageTransports, Middleware } from 'vscode-languageclient/node'
import { DocumentSyncGuard } from '../../languageClient'

const DID_OPEN = 'textDocument/didOpen'
const DID_CLOSE = 'textDocument/didClose'
const DID_CHANGE = 'textDocument/didChange'

type WireMessage = { method: string; uri?: string; version?: number; text?: string }

type JsonRpcMessage = Message & {
    id?: number | string
    method?: string
    params?: { textDocument?: { uri?: string; version?: number; text?: string } }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(condition: () => boolean, what: string, timeoutMs: number = 10000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${what}`)
        }
        await sleep(10)
    }
}

/**
 * An in-process language server that answers `initialize` and `shutdown` and
 * records, in order, every notification the client puts on the wire. The
 * `MessageWriter` is the wire: the jsonrpc connection hands each message to
 * `write` synchronously, and the stream writer the real client uses serializes
 * writes in call order.
 *
 * `holdFirstOpenOf` simulates a write that takes a while to complete, such as a
 * pipe the server is not draining. The first `didOpen` for one of those URIs is
 * recorded, but its `write` does not resolve until `release()`.
 */
class StubServer {
    readonly wire: WireMessage[] = []
    readonly firstOpenHeld: Promise<string>
    private held: string | undefined
    private heldResolve: (() => void) | undefined
    private heldSignal: (uri: string) => void

    constructor(private holdFirstOpenOf: Set<string>) {
        this.firstOpenHeld = new Promise((resolve) => (this.heldSignal = resolve))
    }

    release(): void {
        this.heldResolve?.()
    }

    opened(uri: string): boolean {
        return this.wire.some((m) => m.method === DID_OPEN && m.uri === uri)
    }

    transports(): MessageTransports {
        let callback: DataCallback | undefined
        const reply = (id: number | string, result: unknown) =>
            setTimeout(() => callback?.({ jsonrpc: '2.0', id, result } as Message), 0)

        const reader = new (class extends AbstractMessageReader {
            listen(cb: DataCallback): Disposable {
                callback = cb
                return { dispose: () => (callback = undefined) }
            }
        })()

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const server = this
        const writer = new (class extends AbstractMessageWriter {
            async write(msg: Message): Promise<void> {
                const message = msg as JsonRpcMessage
                if (message.method === undefined) {
                    return
                }
                if (message.id !== undefined) {
                    if (message.method === 'initialize') {
                        // Incremental sync, as the Julia language server uses.
                        reply(message.id, { capabilities: { textDocumentSync: { openClose: true, change: 2 } } })
                    } else {
                        reply(message.id, null)
                    }
                    return
                }
                const textDocument = message.params?.textDocument
                const uri = textDocument?.uri
                server.wire.push({
                    method: message.method,
                    uri,
                    version: textDocument?.version,
                    text: textDocument?.text,
                })
                if (message.method === DID_OPEN && server.held === undefined && server.holdFirstOpenOf.has(uri)) {
                    server.held = uri
                    await new Promise<void>((resolve) => {
                        server.heldResolve = resolve
                        server.heldSignal(uri)
                    })
                }
            }
            end(): void {}
        })()

        return { reader, writer }
    }
}

/**
 * Something that happens to a deferred document while the flush is stalled.
 * `act` triggers it; `event` resolves once VS Code has delivered it to
 * extensions.
 */
type Disturbance = {
    act: (document: vscode.TextDocument) => Thenable<unknown>
    event: (document: vscode.TextDocument) => Promise<void>
}

// Changing a document's language closes it for every language client whose
// selector stops matching. Unlike disposal, it can be triggered on demand.
const closeByLanguageChange: Disturbance = {
    act: (document) => vscode.languages.setTextDocumentLanguage(document, 'plaintext'),
    event: (document) =>
        new Promise((resolve) => {
            const listener = vscode.workspace.onDidCloseTextDocument((closed) => {
                if (closed.uri.toString() === document.uri.toString()) {
                    listener.dispose()
                    resolve()
                }
            })
        }),
}

const editWithoutTab: Disturbance = {
    act: (document) => {
        const edit = new vscode.WorkspaceEdit()
        edit.insert(document.uri, new vscode.Position(0, 0), '# edited\n')
        return vscode.workspace.applyEdit(edit)
    },
    event: (document) =>
        new Promise((resolve) => {
            const listener = vscode.workspace.onDidChangeTextDocument((event) => {
                if (event.document.uri.toString() === document.uri.toString() && event.contentChanges.length > 0) {
                    listener.dispose()
                    resolve()
                }
            })
        }),
}

/**
 * Drives a real `LanguageClient` through vscode-languageclient's deferred
 * `didOpen` flush and disturbs one of the deferred documents while the flush is
 * in progress. Returns what reached the wire for the test's own documents, in
 * order.
 *
 * At start, `DidOpenTextDocumentFeature.register` parks every matching document
 * that has no tab in `_pendingOpenNotifications`. The next notification or
 * request the client sends calls `sendPendingOpenNotifications`, which empties
 * that map and then sends the parked opens one at a time, awaiting each write.
 * A notification for a parked document that arrives while it waits finds the
 * map already empty, so nothing holds it back.
 */
async function runPendingOpenFlush(
    middleware: Middleware | undefined,
    disturbance: Disturbance
): Promise<{ ours: WireMessage[]; victim: vscode.TextDocument }> {
    // Documents opened without being shown have no tab, which is exactly what
    // `register` parks: documents opened by an extension, or whose tab was
    // closed while the model stays alive.
    const documents: vscode.TextDocument[] = []
    for (let i = 0; i < 4; i++) {
        documents.push(await vscode.workspace.openTextDocument({ language: 'julia', content: `x${i} = ${i}\n` }))
    }
    const ourUris = new Set(documents.map((document) => document.uri.toString()))

    const server = new StubServer(ourUris)
    const client = new LanguageClient('julia-c62-repro', 'c62 repro', () => Promise.resolve(server.transports()), {
        documentSelector: [{ scheme: 'untitled', language: 'julia' }],
        middleware,
    })

    try {
        await client.start()
        // Anything the client sends triggers the flush. If a visible julia
        // document in the test window already did, this one just queues.
        void client.sendNotification('julia/c62/trigger').catch(() => {})

        const held = await server.firstOpenHeld
        // The flush is stalled on `held`, so every other test document is still
        // waiting for its didOpen.
        const victim = documents.find((document) => document.uri.toString() !== held)
        assert.ok(!server.opened(victim.uri.toString()), 'the victim was opened before the flush stalled')

        const delivered = disturbance.event(victim)
        await disturbance.act(victim)
        await delivered
        // The client handles the event in microtasks; a timer turn lets the
        // resulting notification reach the wire, or be dropped.
        await sleep(50)

        server.release()
        await waitFor(
            () => documents.every((document) => document === victim || server.opened(document.uri.toString())),
            'the flush to send the remaining opens'
        )
        await sleep(50)

        return { ours: server.wire.filter((m) => m.uri !== undefined && ourUris.has(m.uri)), victim }
    } finally {
        server.release()
        await client.stop(2000).catch(() => {})
    }
}

/** URIs of notifications on the wire that are not preceded by their didOpen. */
function sentBeforeOpen(wire: WireMessage[], method: string): string[] {
    const open = new Set<string>()
    const offending: string[] = []
    for (const m of wire) {
        if (m.method === DID_OPEN) {
            open.add(m.uri)
        } else if (m.method === DID_CLOSE) {
            if (!open.delete(m.uri) && method === DID_CLOSE) {
                offending.push(m.uri)
            }
        } else if (m.method === method && !open.has(m.uri)) {
            offending.push(m.uri)
        }
    }
    return offending
}

function guardMiddleware(guard: DocumentSyncGuard): Middleware {
    return {
        didOpen: (document, next) => guard.didOpen(document, next),
        sendNotification: (type, next, params) => guard.sendNotification(type, next, params),
    }
}

suite('Deferred didOpen flush race (c62)', () => {
    // These two document the upstream bug the guard exists for. If they start
    // failing after a vscode-languageclient update, the race has been fixed
    // upstream.
    test('vscode-languageclient sends a didClose ahead of the deferred didOpen', async function () {
        this.timeout(20000)
        const { ours, victim } = await runPendingOpenFlush(undefined, closeByLanguageChange)

        assert.deepStrictEqual(sentBeforeOpen(ours, DID_CLOSE), [victim.uri.toString()], JSON.stringify(ours))
    })

    test('vscode-languageclient sends a didChange ahead of the deferred didOpen', async function () {
        this.timeout(20000)
        const { ours, victim } = await runPendingOpenFlush(undefined, editWithoutTab)

        assert.deepStrictEqual(sentBeforeOpen(ours, DID_CHANGE), [victim.uri.toString()], JSON.stringify(ours))
    })

    test('DocumentSyncGuard keeps the didClose from overtaking its didOpen', async function () {
        this.timeout(20000)
        const dropped: string[] = []
        const guard = new DocumentSyncGuard((method) => dropped.push(method))
        const { ours, victim } = await runPendingOpenFlush(guardMiddleware(guard), closeByLanguageChange)

        assert.deepStrictEqual(sentBeforeOpen(ours, DID_CLOSE), [], JSON.stringify(ours))
        // The deferred didOpen is not sent either: the document no longer
        // matches the selector by the time the flush reaches it.
        assert.ok(
            ours.every((m) => m.uri !== victim.uri.toString()),
            JSON.stringify(ours)
        )
        assert.deepStrictEqual(dropped, [DID_CLOSE])
    })

    test('DocumentSyncGuard keeps the didChange from overtaking its didOpen, and loses no edit', async function () {
        this.timeout(20000)
        const dropped: string[] = []
        const guard = new DocumentSyncGuard((method) => dropped.push(method))
        const { ours, victim } = await runPendingOpenFlush(guardMiddleware(guard), editWithoutTab)

        assert.deepStrictEqual(sentBeforeOpen(ours, DID_CHANGE), [], JSON.stringify(ours))
        // The deferred didOpen is built from the live document, so it carries
        // the edit whose didChange was dropped.
        const victimMessages = ours.filter((m) => m.uri === victim.uri.toString())
        assert.deepStrictEqual(victimMessages, [
            { method: DID_OPEN, uri: victim.uri.toString(), version: victim.version, text: victim.getText() },
        ])
        assert.ok(victim.getText().startsWith('# edited\n'))
        assert.deepStrictEqual(dropped, [DID_CHANGE])
    })
})

suite('DocumentSyncGuard', () => {
    const uri = 'untitled:Untitled-42'
    const openParams = { textDocument: { uri, languageId: 'julia', version: 1, text: '' } }
    const changeParams = { textDocument: { uri, version: 2 }, contentChanges: [{ text: 'x' }] }
    const closeParams = { textDocument: { uri } }

    function makeGuard(): { guard: DocumentSyncGuard; dropped: string[]; sent: string[] } {
        const dropped: string[] = []
        const sent: string[] = []
        const guard = new DocumentSyncGuard((method) => dropped.push(method))
        return { guard, dropped, sent }
    }

    function send(guard: DocumentSyncGuard, sent: string[], method: string, params: unknown): Promise<void> {
        return guard.sendNotification(
            method,
            (type) => {
                sent.push(typeof type === 'string' ? type : type.method)
                return Promise.resolve()
            },
            params
        )
    }

    test('forwards a didChange and a didClose after their didOpen', async () => {
        const { guard, dropped, sent } = makeGuard()

        await send(guard, sent, DID_OPEN, openParams)
        await send(guard, sent, DID_CHANGE, changeParams)
        await send(guard, sent, DID_CLOSE, closeParams)

        assert.deepStrictEqual(sent, [DID_OPEN, DID_CHANGE, DID_CLOSE])
        assert.deepStrictEqual(dropped, [])
    })

    test('drops a didChange whose didOpen was never forwarded', async () => {
        const { guard, dropped, sent } = makeGuard()

        await send(guard, sent, DID_CHANGE, changeParams)

        assert.deepStrictEqual(sent, [])
        assert.deepStrictEqual(dropped, [DID_CHANGE])
    })

    test('drops a didChange after the didClose', async () => {
        const { guard, dropped, sent } = makeGuard()

        await send(guard, sent, DID_OPEN, openParams)
        await send(guard, sent, DID_CLOSE, closeParams)
        await send(guard, sent, DID_CHANGE, changeParams)

        assert.deepStrictEqual(sent, [DID_OPEN, DID_CLOSE])
        assert.deepStrictEqual(dropped, [DID_CHANGE])
    })

    test('drops a didClose whose didOpen was never forwarded', async () => {
        const { guard, dropped, sent } = makeGuard()

        await send(guard, sent, DID_CLOSE, closeParams)

        assert.deepStrictEqual(sent, [])
        assert.deepStrictEqual(dropped, [DID_CLOSE])
    })

    test('drops a second didClose for the same didOpen', async () => {
        const { guard, dropped, sent } = makeGuard()

        await send(guard, sent, DID_OPEN, openParams)
        await send(guard, sent, DID_CLOSE, closeParams)
        await send(guard, sent, DID_CLOSE, closeParams)

        assert.deepStrictEqual(sent, [DID_OPEN, DID_CLOSE])
        assert.deepStrictEqual(dropped, [DID_CLOSE])
    })

    test('forgets forwarded opens on reset', async () => {
        const { guard, dropped, sent } = makeGuard()

        await send(guard, sent, DID_OPEN, openParams)
        guard.reset()
        await send(guard, sent, DID_CLOSE, closeParams)

        assert.deepStrictEqual(sent, [DID_OPEN])
        assert.deepStrictEqual(dropped, [DID_CLOSE])
    })

    test('forwards notifications that are not about the document lifecycle', async () => {
        const { guard, dropped, sent } = makeGuard()

        await send(guard, sent, 'workspace/didChangeConfiguration', { settings: {} })
        await send(guard, sent, 'julia/custom', undefined)

        assert.deepStrictEqual(sent, ['workspace/didChangeConfiguration', 'julia/custom'])
        assert.deepStrictEqual(dropped, [])
    })

    test('drops the didOpen of a document that is already closed', async () => {
        const { guard, dropped } = makeGuard()
        let called = false

        await guard.didOpen({ isClosed: true } as vscode.TextDocument, () => {
            called = true
            return Promise.resolve()
        })

        assert.strictEqual(called, false)
        assert.deepStrictEqual(dropped, [DID_OPEN])
    })

    test('forwards the didOpen of an open document', async () => {
        const { guard, dropped } = makeGuard()
        const document = await vscode.workspace.openTextDocument({ language: 'julia', content: 'x = 1\n' })
        let forwarded: vscode.TextDocument | undefined

        await guard.didOpen(document, (d) => {
            forwarded = d
            return Promise.resolve()
        })

        assert.strictEqual(forwarded, document)
        assert.deepStrictEqual(dropped, [])
    })
})
