import * as assert from 'assert'
import * as vscode from 'vscode'
import { NotebookNode, REPLTreeDataProvider, WorkspaceFeature } from '../../interactive/workspace'
import { JuliaKernel } from '../../notebook/notebookKernel'

suite('show/hide modules without a REPL', () => {
    const config = () => vscode.workspace.getConfiguration('julia')
    let saved: boolean | undefined

    setup(() => {
        saved = config().inspect<boolean>('workspace.showModules').globalValue
    })

    teardown(async () => {
        await config().update('workspace.showModules', saved, vscode.ConfigurationTarget.Global)
    })

    /** A workspace feature as it is before any REPL has connected, or after the last one exited. */
    function build(notebookNodes: NotebookNode[] = []) {
        const feature = { _REPLNode: null, _NotebookNodes: notebookNodes } as unknown as WorkspaceFeature
        return new REPLTreeDataProvider(feature)
    }

    test('saves the setting when there is no session at all', async () => {
        const provider = build()
        const target = !config().get<boolean>('workspace.showModules')

        await provider.toggleModules(target)

        assert.strictEqual(config().get<boolean>('workspace.showModules'), target)
    })

    test('still applies to notebook sessions', async () => {
        // No connection, so refreshing its variables is a no-op rather than a request.
        const node = new NotebookNode({ _msgConnection: undefined } as unknown as JuliaKernel, undefined)
        const provider = build([node])
        const target = !config().get<boolean>('workspace.showModules')

        await provider.toggleModules(target)

        assert.strictEqual(node._showModules, target)
        assert.strictEqual(config().get<boolean>('workspace.showModules'), target)
    })
})
