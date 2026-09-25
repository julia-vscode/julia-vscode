import * as assert from 'assert'
import * as vscode from 'vscode'
import { PositionValidationGuard } from '../../languageClient'

type Drop = { provider: string; detail: string }

function makeGuard(): { guard: PositionValidationGuard; drops: Drop[] } {
    const drops: Drop[] = []
    const guard = new PositionValidationGuard((provider, detail) => drops.push({ provider, detail }))
    return { guard, drops }
}

// Three lines, no trailing newline: addressable lines are 0, 1 and 2.
const CONTENT = 'module A\n\nend'

async function juliaDocument(content: string = CONTENT): Promise<vscode.TextDocument> {
    return await vscode.workspace.openTextDocument({ content, language: 'julia' })
}

suite('PositionValidationGuard', () => {
    test('forwards a position the document can address', async () => {
        const document = await juliaDocument()
        const { guard, drops } = makeGuard()
        let called = false

        const result = guard.at('hover', document, new vscode.Position(2, 1), () => {
            called = true
            return 'forwarded'
        })

        assert.strictEqual(called, true)
        assert.strictEqual(result, 'forwarded')
        assert.deepStrictEqual(drops, [])
    })

    test('drops a position past the last line without calling next', async () => {
        const document = await juliaDocument()
        const { guard, drops } = makeGuard()
        let called = false

        // `new Position(document.lineCount, 0)` — the classic off-by-one for
        // "end of document", and the single most common shape in the crash
        // telemetry this guard exists for.
        const result = guard.at('documentHighlight', document, new vscode.Position(document.lineCount, 0), () => {
            called = true
            return 'forwarded'
        })

        assert.strictEqual(called, false)
        assert.strictEqual(result, undefined)
        assert.strictEqual(drops.length, 1)
        assert.strictEqual(drops[0].provider, 'documentHighlight')
        assert.strictEqual(drops[0].detail, 'line=3 line_count=3')
    })

    test('drops a wildly out of range position', async () => {
        const document = await juliaDocument()
        const { guard, drops } = makeGuard()

        const result = guard.at('completion', document, new vscode.Position(10000, 10000), () => 'forwarded')

        assert.strictEqual(result, undefined)
        assert.strictEqual(drops[0].detail, 'line=10000 line_count=3')
    })

    test('an empty document can still address its single line', async () => {
        const document = await juliaDocument('')
        const { guard, drops } = makeGuard()

        assert.strictEqual(
            guard.at('hover', document, new vscode.Position(0, 0), () => 'forwarded'),
            'forwarded'
        )
        // The shape the 2020 report opened with: an empty document asked about
        // line 4, character 11 (microsoft/language-server-protocol#946).
        assert.strictEqual(
            guard.at('hover', document, new vscode.Position(4, 11), () => 'forwarded'),
            undefined
        )
        assert.strictEqual(drops.length, 1)
        assert.strictEqual(drops[0].detail, 'line=4 line_count=1')
    })

    test('a character past the end of its line is forwarded', async () => {
        const document = await juliaDocument()
        const { guard, drops } = makeGuard()

        // The server clamps an overlong character to the end of the line, so
        // this is not the failure mode and must not be suppressed.
        assert.strictEqual(
            guard.at('definition', document, new vscode.Position(0, 500), () => 'forwarded'),
            'forwarded'
        )
        assert.deepStrictEqual(drops, [])
    })

    test('atAll forwards only when every position is addressable', async () => {
        const document = await juliaDocument()
        const { guard, drops } = makeGuard()

        assert.strictEqual(
            guard.atAll(
                'selectionRange',
                document,
                [new vscode.Position(0, 0), new vscode.Position(2, 0)],
                () => 'forwarded'
            ),
            'forwarded'
        )
        assert.deepStrictEqual(drops, [])
    })

    test('atAll drops the whole request when one position is out of range', async () => {
        const document = await juliaDocument()
        const { guard, drops } = makeGuard()
        let called = false

        const result = guard.atAll(
            'codeAction',
            document,
            [new vscode.Position(0, 0), new vscode.Position(99, 0)],
            () => {
                called = true
                return 'forwarded'
            }
        )

        assert.strictEqual(called, false)
        assert.strictEqual(result, undefined)
        assert.strictEqual(drops.length, 1)
        assert.strictEqual(drops[0].provider, 'codeAction')
    })

    test('reports the first out of range position once per request', async () => {
        const document = await juliaDocument()
        const { guard, drops } = makeGuard()

        guard.atAll('codeAction', document, [new vscode.Position(50, 0), new vscode.Position(99, 0)], () => 'forwarded')

        assert.strictEqual(drops.length, 1)
        assert.strictEqual(drops[0].detail, 'line=50 line_count=3')
    })
})
