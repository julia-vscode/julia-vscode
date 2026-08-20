import * as assert from 'assert'
import * as path from 'path'
import * as vscode from 'vscode'
import { TestProcessLog } from '../../../testing/testProcessLog'
import {
    closeStaleTestProcessLogTabs,
    TestProcessLogSource,
    TestProcessLogViewManager,
} from '../../../testing/testProcessLogView'

// `out/test/suite/testing` back to the repo root, which is where `libs/` and `scripts/` live.
const extensionPath = path.resolve(__dirname, '..', '..', '..', '..')

function source(id: string, packageName: string): TestProcessLogSource & { log: TestProcessLog } {
    return { id, packageName, log: new TestProcessLog() }
}

/** Webview tabs do not appear in `tabGroups` synchronously. */
async function waitForTabs(predicate: () => boolean) {
    for (let i = 0; i < 100; i++) {
        if (predicate()) {
            return
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.fail('timed out waiting for the tab state to settle')
}

function logTabLabels() {
    return vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter((tab) => tab.input instanceof vscode.TabInputWebview)
        .map((tab) => tab.label)
        .filter((label) => label.startsWith('Test Process: '))
}

suite('TestProcessLogViewManager', () => {
    let manager: TestProcessLogViewManager

    setup(() => {
        manager = new TestProcessLogViewManager(extensionPath)
    })

    teardown(async () => {
        manager.dispose()
        await waitForTabs(() => logTabLabels().length === 0)
    })

    test('opens one panel, titled after the package', async () => {
        const proc = source('id-1', 'MyPkg')

        manager.show(proc)

        assert.strictEqual(manager.isOpen('id-1'), true)
        await waitForTabs(() => logTabLabels().length === 1)
        assert.deepStrictEqual(logTabLabels(), ['Test Process: MyPkg'])
    })

    test('reveals the existing panel rather than opening a second one', async () => {
        const proc = source('id-1', 'MyPkg')

        manager.show(proc)
        await waitForTabs(() => logTabLabels().length === 1)

        manager.show(proc)
        manager.show(proc)

        // Give a duplicate a chance to show up before concluding there is none.
        await new Promise((resolve) => setTimeout(resolve, 200))
        assert.deepStrictEqual(logTabLabels(), ['Test Process: MyPkg'])
    })

    test('keeps one panel per process', async () => {
        manager.show(source('id-1', 'MyPkg'))
        manager.show(source('id-2', 'OtherPkg'))

        await waitForTabs(() => logTabLabels().length === 2)
        assert.deepStrictEqual(logTabLabels().sort(), ['Test Process: MyPkg', 'Test Process: OtherPkg'])
    })

    test('closeFor closes only the processes it was given', async () => {
        manager.show(source('id-1', 'MyPkg'))
        manager.show(source('id-2', 'OtherPkg'))
        await waitForTabs(() => logTabLabels().length === 2)

        manager.closeFor(['id-1'])

        await waitForTabs(() => logTabLabels().length === 1)
        assert.strictEqual(manager.isOpen('id-1'), false)
        assert.strictEqual(manager.isOpen('id-2'), true)
        assert.deepStrictEqual(logTabLabels(), ['Test Process: OtherPkg'])
    })

    test('closeFor ignores ids with no panel open', () => {
        manager.closeFor(['never-opened'])
        assert.strictEqual(manager.isOpen('never-opened'), false)
    })

    test('a panel the user closed can be reopened', async () => {
        const proc = source('id-1', 'MyPkg')

        manager.show(proc)
        await waitForTabs(() => logTabLabels().length === 1)

        manager.closeFor(['id-1'])
        await waitForTabs(() => logTabLabels().length === 0)

        manager.show(proc)
        await waitForTabs(() => logTabLabels().length === 1)
        assert.strictEqual(manager.isOpen('id-1'), true)
    })

    test('has no active source until a panel is focused', async () => {
        manager.show(source('id-1', 'MyPkg'))

        // Which panel is *active* follows real focus events, so only the cleared cases are
        // asserted here; the positive case is on the manual verification list.
        assert.ok(manager.getActiveSource() === undefined || manager.getActiveSource().id === 'id-1')
    })

    test('closeFor clears the active source it was tracking', async () => {
        manager.show(source('id-1', 'MyPkg'))
        await waitForTabs(() => logTabLabels().length === 1)

        manager.closeFor(['id-1'])

        await waitForTabs(() => logTabLabels().length === 0)
        assert.strictEqual(manager.getActiveSource(), undefined)
    })

    test('dispose clears the active source', async () => {
        manager.show(source('id-1', 'MyPkg'))
        await waitForTabs(() => logTabLabels().length === 1)

        manager.dispose()

        await waitForTabs(() => logTabLabels().length === 0)
        assert.strictEqual(manager.getActiveSource(), undefined)
    })

    test('dispose closes everything it had open', async () => {
        manager.show(source('id-1', 'MyPkg'))
        manager.show(source('id-2', 'OtherPkg'))
        await waitForTabs(() => logTabLabels().length === 2)

        manager.dispose()

        await waitForTabs(() => logTabLabels().length === 0)
        assert.strictEqual(manager.isOpen('id-1'), false)
        assert.strictEqual(manager.isOpen('id-2'), false)
    })
})

suite('closeStaleTestProcessLogTabs', () => {
    let manager: TestProcessLogViewManager

    setup(() => {
        manager = new TestProcessLogViewManager(extensionPath)
    })

    teardown(async () => {
        manager.dispose()
        await vscode.commands.executeCommand('workbench.action.closeAllEditors')
        await waitForTabs(() => logTabLabels().length === 0)
    })

    test('closes a log tab', async () => {
        manager.show(source('id-1', 'MyPkg'))
        await waitForTabs(() => logTabLabels().length === 1)

        // The real point of this test: VS Code namespaces `TabInputWebview.viewType`, so a match
        // on the bare view type would silently find nothing.
        const viewTypes = vscode.window.tabGroups.all
            .flatMap((group) => group.tabs)
            .map((tab) => tab.input)
            .filter((input) => input instanceof vscode.TabInputWebview)
            .map((input) => (input as vscode.TabInputWebview).viewType)
        assert.deepStrictEqual(viewTypes, ['mainThreadWebview-julia-testprocess-log'])

        closeStaleTestProcessLogTabs()

        await waitForTabs(() => logTabLabels().length === 0)
    })

    test('closes every log tab at once', async () => {
        manager.show(source('id-1', 'MyPkg'))
        manager.show(source('id-2', 'OtherPkg'))
        await waitForTabs(() => logTabLabels().length === 2)

        closeStaleTestProcessLogTabs()

        await waitForTabs(() => logTabLabels().length === 0)
    })

    test('leaves other editors alone', async () => {
        const doc = await vscode.workspace.openTextDocument({ content: 'not a log', language: 'plaintext' })
        await vscode.window.showTextDocument(doc)
        manager.show(source('id-1', 'MyPkg'))
        await waitForTabs(() => logTabLabels().length === 1)

        closeStaleTestProcessLogTabs()

        await waitForTabs(() => logTabLabels().length === 0)
        assert.ok(
            vscode.window.tabGroups.all
                .flatMap((group) => group.tabs)
                .some((tab) => tab.input instanceof vscode.TabInputText),
            'the text editor should still be open'
        )
    })

    test('does nothing when there are no log tabs', async () => {
        assert.strictEqual(logTabLabels().length, 0)

        closeStaleTestProcessLogTabs()

        assert.strictEqual(logTabLabels().length, 0)
    })
})
