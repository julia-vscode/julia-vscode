import * as assert from 'assert'
import * as vscode from 'vscode'
import {
    REPLTreeDataProvider,
    TestControllerNode,
    TestProcessGroupNode,
    TestProcessNode,
} from '../../../interactive/workspace'
import { JuliaTestProcess } from '../../../testing/testFeature'

function build() {
    // The workspace feature is unreachable from the code under test — the provider only fires
    // its change emitter — and the host is recorded rather than acted on, since starting a real
    // controller is not what these tests are about.
    const provider = new REPLTreeDataProvider(undefined)
    const calls: string[] = []
    const host = {
        startTestController: async () => void calls.push('start'),
        stopTestController: async () => void calls.push('stop'),
        restartTestController: async () => void calls.push('restart'),
    }
    const controllerNode = new TestControllerNode(host, provider)

    const add = (id: string, packageName: string) => {
        const proc = new JuliaTestProcess(
            id,
            packageName,
            'file:///pkg',
            'file:///pkg/Project.toml',
            false,
            {},
            'release',
            undefined
        )
        const node = new TestProcessNode(proc, provider)
        controllerNode.addTestProcessNode(node)
        return { proc, node }
    }

    return { provider, controllerNode, add, calls }
}

async function groupsOf(provider: REPLTreeDataProvider, controllerNode: TestControllerNode) {
    const children = (await provider.getChildren(controllerNode)) as TestProcessGroupNode[]
    return children.map((i) => i.kind)
}

suite('test process tree', () => {
    test('shows only the Active group while nothing has terminated', async () => {
        const { provider, controllerNode, add } = build()
        add('a', 'MyPkg')
        add('b', 'OtherPkg')

        assert.deepStrictEqual(await groupsOf(provider, controllerNode), ['active'])
    })

    test('shows no groups at all before any process exists', async () => {
        const { provider, controllerNode } = build()

        assert.deepStrictEqual(await groupsOf(provider, controllerNode), [])
    })

    test('splits the processes once one terminates', async () => {
        const { provider, controllerNode, add } = build()
        const live = add('a', 'MyPkg')
        const dead = add('b', 'OtherPkg')

        dead.proc.markTerminated()

        const groups = (await provider.getChildren(controllerNode)) as TestProcessGroupNode[]
        assert.deepStrictEqual(
            groups.map((i) => i.kind),
            ['active', 'terminated']
        )

        assert.deepStrictEqual(await provider.getChildren(groups[0]), [live.node])
        assert.deepStrictEqual(await provider.getChildren(groups[1]), [dead.node])
    })

    test('drops the Active group when every process has terminated', async () => {
        const { provider, controllerNode, add } = build()
        const only = add('a', 'MyPkg')

        only.proc.markTerminated()

        assert.deepStrictEqual(await groupsOf(provider, controllerNode), ['terminated'])
    })

    test('returns the same group node across refreshes, so expansion state survives', async () => {
        const { provider, controllerNode, add } = build()
        add('a', 'MyPkg')

        const first = await provider.getChildren(controllerNode)
        const second = await provider.getChildren(controllerNode)

        assert.strictEqual(first[0], second[0])
    })

    test('labels the groups', async () => {
        const { provider, controllerNode, add } = build()
        add('a', 'MyPkg')
        add('b', 'OtherPkg').proc.markTerminated()

        const groups = (await provider.getChildren(controllerNode)) as TestProcessGroupNode[]
        const items = groups.map((i) => provider.getTreeItem(i))

        assert.deepStrictEqual(
            items.map((i) => i.label),
            ['Active', 'Terminated']
        )
        assert.deepStrictEqual(
            items.map((i) => i.contextValue),
            ['juliatestprocessgroup-active', 'juliatestprocessgroup-terminated']
        )
        assert.deepStrictEqual(
            items.map((i) => i.collapsibleState),
            [vscode.TreeItemCollapsibleState.Expanded, vscode.TreeItemCollapsibleState.Expanded]
        )
    })

    test('an active process offers stopping and opening its log', () => {
        const { provider, add } = build()
        const { node } = add('a', 'MyPkg')

        const item = provider.getTreeItem(node)

        assert.strictEqual(item.contextValue, 'juliatestprocess')
        assert.strictEqual(item.description, 'MyPkg')
        assert.strictEqual(item.command?.command, 'language-julia.showTestProcessLog')
        assert.deepStrictEqual(item.command?.arguments, [node])
    })

    test('a terminated process still opens its log, but is not offered for stopping', () => {
        const { provider, add } = build()
        const { proc, node } = add('a', 'MyPkg')

        proc.markTerminated()
        const item = provider.getTreeItem(node)

        // The inline stop button is gated on the exact value `juliatestprocess`.
        assert.strictEqual(item.contextValue, 'juliatestprocess-terminated')
        assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'circle-slash')
        assert.strictEqual(item.command?.command, 'language-julia.showTestProcessLog')
    })

    test('clearTerminated removes only the dead processes and reports their ids', async () => {
        const { provider, controllerNode, add } = build()
        add('a', 'MyPkg')
        const dead = add('b', 'OtherPkg')
        const alsoDead = add('c', 'ThirdPkg')

        dead.proc.markTerminated()
        alsoDead.proc.markTerminated()

        const removed = controllerNode.clearTerminated()

        assert.deepStrictEqual(removed.sort(), ['b', 'c'])
        assert.deepStrictEqual(await groupsOf(provider, controllerNode), ['active'])
        assert.deepStrictEqual(controllerNode.nodesFor('terminated'), [])
        assert.deepStrictEqual(
            controllerNode.nodesFor('active').map((i) => i.testProcess.id),
            ['a']
        )
    })

    test('clearTerminated on a controller with nothing dead is a no-op', () => {
        const { controllerNode, add } = build()
        add('a', 'MyPkg')

        assert.deepStrictEqual(controllerNode.clearTerminated(), [])
        assert.strictEqual(controllerNode.nodesFor('active').length, 1)
    })
})

suite('test controller node', () => {
    test('is shown with no processes at all, and offers no twistie', () => {
        const { provider, controllerNode } = build()

        const item = provider.getTreeItem(controllerNode)

        assert.strictEqual(item.label, 'Julia Test Item Controller')
        assert.strictEqual(item.collapsibleState, vscode.TreeItemCollapsibleState.None)
    })

    test('expands once it has processes', () => {
        const { provider, controllerNode, add } = build()
        add('a', 'MyPkg')

        assert.strictEqual(
            provider.getTreeItem(controllerNode).collapsibleState,
            vscode.TreeItemCollapsibleState.Expanded
        )
    })

    test('starts out stopped', () => {
        const { provider, controllerNode } = build()

        const item = provider.getTreeItem(controllerNode)

        assert.strictEqual(controllerNode.getState(), 'stopped')
        assert.strictEqual(item.description, 'Not running')
        assert.strictEqual(item.contextValue, 'juliatestcontroller-stopped')
        assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'debug-disconnect')
    })

    test('renders each state distinctly, so the right buttons show', () => {
        const { provider, controllerNode } = build()

        controllerNode.setState('starting')
        let item = provider.getTreeItem(controllerNode)
        assert.strictEqual(item.description, 'Starting…')
        assert.strictEqual(item.contextValue, 'juliatestcontroller-starting')
        assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'gear~spin')

        controllerNode.setState('running')
        item = provider.getTreeItem(controllerNode)
        assert.strictEqual(item.description, 'Running')
        assert.strictEqual(item.contextValue, 'juliatestcontroller-running')
        assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'test-view-icon')
    })

    test('the buttons reach the host', async () => {
        const { controllerNode, calls } = build()

        await controllerNode.start()
        await controllerNode.restart()
        await controllerNode.stop()

        assert.deepStrictEqual(calls, ['start', 'restart', 'stop'])
    })

    test('keeps terminated processes and their logs when the controller dies', async () => {
        const { provider, controllerNode, add } = build()
        const one = add('a', 'MyPkg')
        const two = add('b', 'OtherPkg')
        one.proc.log.append('output from a\n')

        // What the controller's exit handler does: mark, but never dispose.
        for (const i of [one, two]) {
            i.proc.markTerminated()
        }
        controllerNode.setState('stopped')

        assert.deepStrictEqual(await groupsOf(provider, controllerNode), ['terminated'])
        assert.ok(one.proc.log.getFullText().includes('output from a'))
        assert.strictEqual(provider.getTreeItem(controllerNode).contextValue, 'juliatestcontroller-stopped')
    })

    test('removeProcess drops exactly one, and reports whether it found it', async () => {
        const { provider, controllerNode, add } = build()
        add('a', 'MyPkg')
        add('b', 'OtherPkg').proc.markTerminated()
        add('c', 'ThirdPkg').proc.markTerminated()

        assert.strictEqual(controllerNode.removeProcess('b'), true)

        assert.deepStrictEqual(
            controllerNode.nodesFor('terminated').map((i) => i.testProcess.id),
            ['c']
        )
        assert.deepStrictEqual(
            controllerNode.nodesFor('active').map((i) => i.testProcess.id),
            ['a']
        )
        assert.deepStrictEqual(await groupsOf(provider, controllerNode), ['active', 'terminated'])
    })

    test('removeProcess reports an id it does not have', () => {
        const { controllerNode, add } = build()
        add('a', 'MyPkg')

        assert.strictEqual(controllerNode.removeProcess('nope'), false)
        assert.strictEqual(controllerNode.nodesFor('active').length, 1)
    })
})

suite('removing test processes redraws the tree', () => {
    /** Count the change notifications the tree view would act on. */
    function watch(provider: REPLTreeDataProvider) {
        const seen = { count: 0 }
        provider.onDidChangeTreeData(() => seen.count++)
        return seen
    }

    test('clearTerminated refreshes, so the child nodes actually disappear', async () => {
        const { provider, controllerNode, add } = build()
        add('a', 'MyPkg')
        add('b', 'OtherPkg').proc.markTerminated()
        const redraws = watch(provider)

        controllerNode.clearTerminated()

        // Nothing else redraws on this path: the command calls the group node directly.
        assert.strictEqual(redraws.count, 1)
        assert.deepStrictEqual(await groupsOf(provider, controllerNode), ['active'])
    })

    test('removeProcess refreshes too', () => {
        const { provider, controllerNode, add } = build()
        add('a', 'MyPkg').proc.markTerminated()
        const redraws = watch(provider)

        controllerNode.removeProcess('a')

        assert.strictEqual(redraws.count, 1)
    })

    test('a removal that changes nothing does not redraw', () => {
        const { provider, controllerNode, add } = build()
        add('a', 'MyPkg')
        const redraws = watch(provider)

        controllerNode.removeProcess('nope')
        controllerNode.clearTerminated()

        assert.strictEqual(redraws.count, 0)
    })
})
