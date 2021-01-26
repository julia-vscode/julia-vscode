import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc/node'
import { onExit, onFinishEval, onInit } from './repl'

interface DebugConfigTreeItem {
    label: string
    hasChildren?: boolean
    juliaAccessor?: string
}

const requestTypeGetDebugItems = new rpc.RequestType<
    { juliaAccessor: string },
    DebugConfigTreeItem[],
    void>('repl/getDebugItems')

export class DebugConfigTreeProvider implements vscode.TreeDataProvider<DebugConfigTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<DebugConfigTreeItem | undefined> = new vscode.EventEmitter<DebugConfigTreeItem | undefined>()
    readonly onDidChangeTreeData: vscode.Event<DebugConfigTreeItem | undefined> = this._onDidChangeTreeData.event
    private _compiledItems: Set<string> = new Set()
    private _connection = null

    refresh(el = null): void {
        this._onDidChangeTreeData.fire(el)
    }

    setConnection(conn) {
        this._connection = conn
    }

    getChildren(node?: DebugConfigTreeItem): vscode.ProviderResult<DebugConfigTreeItem[]> {
        if (node) {
            if (node.hasChildren) {
                if (this._connection) {
                    const accessor = node.juliaAccessor || '#root'
                    return Promise.race([
                        this._connection.sendRequest(requestTypeGetDebugItems, { juliaAccessor: accessor }),
                        new Promise(resolve => {
                            setTimeout(() => resolve([]), 10000)
                        })
                    ])
                }
                return []
            } else {
                return []
            }
        }
        return this.getToplevelItems()
    }

    getToplevelItems(): DebugConfigTreeItem[] {
        return [
            {
                label: 'All loaded modules',
                hasChildren: true,
                juliaAccessor: '#root'
            }
        ]
    }

    getTreeItem(node: DebugConfigTreeItem): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(node.label)
        const id = this.getNodeId(node)
        const parent = <DebugConfigTreeItem | undefined>this.getParent(node)
        let anyAncestorCompiledAll = false

        // this is bad and I feel bad
        let p = node
        while (true) {
            p = <DebugConfigTreeItem | undefined>this.getParent(p)
            if (p === undefined || !p.juliaAccessor) {
                break
            }
            if (this._compiledItems.has(this.getNodeId(p) + '.')) {
                anyAncestorCompiledAll = true
                break
            }
        }
        const compiledBecauseParentIsCompiled = node.hasChildren ? parent && this._compiledItems.has(this.getNodeId(parent) + '.') : parent && this._compiledItems.has(this.getNodeId(parent))
        const isCompiled = this._compiledItems.has(id) || compiledBecauseParentIsCompiled || anyAncestorCompiledAll
        if (id !== '#root') {
            treeItem.description = isCompiled ? 'compiled' : 'interpreted'
            treeItem.tooltip = isCompiled ? 'Compiled code cannot be stepped through and breakpoints are disregarded.' : 'Interpreted code can be stepped through and breakpoints are respected.'
            treeItem.contextValue = compiledBecauseParentIsCompiled || anyAncestorCompiledAll ? '' : node.hasChildren ? (isCompiled ? 'is-compiled-with-children' : 'is-interpreted-with-children') : (isCompiled ? 'is-compiled' : 'is-interpreted')
        }
        treeItem.collapsibleState = node.hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        treeItem.id = id
        return treeItem
    }

    getParent(node: DebugConfigTreeItem): vscode.ProviderResult<DebugConfigTreeItem> {
        if (node.juliaAccessor === undefined) {
            return
        } else {
            const path = node.juliaAccessor
            const parts = path.split('.')
            if (parts.length === 0) {
                return
            } else {
                parts.pop()
                return {
                    label: parts[parts.length - 1], // previous name
                    hasChildren: true, // by definition
                    juliaAccessor: parts.join('.')
                }
            }
        }
    }

    switchStatus(node: DebugConfigTreeItem, compiled: boolean, all: boolean = false) {
        if (node === undefined) {
            console.error('switchStatus called with undefined!')
            return
        }
        const id = this.getNodeId(node)
        if (compiled) {
            if (all) {
                this._compiledItems.add(id + '.')
            }
            this._compiledItems.add(id)
        } else {
            this._compiledItems.delete(id)
            this._compiledItems.delete(id + '.')
        }
        this.refresh(node)
    }

    getNodeId(node: DebugConfigTreeItem): string {
        return node.juliaAccessor || node.label
    }

    getCompiledItems() {
        return [...this._compiledItems]
    }

    applyDefaults() {
        this.reset()

        const defaults: string[] = vscode.workspace.getConfiguration('julia').get('debuggerDefaultCompiled')
        defaults.forEach(el => this._compiledItems.add(el))
        this.refresh()
    }

    reset() {
        this._compiledItems.clear()
        this.refresh()
    }
}

export function activate(context: vscode.ExtensionContext) {
    const provider = new DebugConfigTreeProvider()
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('debugger-compiled', provider),
        vscode.commands.registerCommand('language-julia.switchToCompiled', (item: DebugConfigTreeItem) => {
            provider.switchStatus(item, true, false)
        }),
        vscode.commands.registerCommand('language-julia.switchToInterpreted', (item: DebugConfigTreeItem) => {
            provider.switchStatus(item, false, false)
        }),
        vscode.commands.registerCommand('language-julia.switchAllToCompiled', (item: DebugConfigTreeItem) => {
            provider.switchStatus(item, true, true)
        }),
        vscode.commands.registerCommand('language-julia.switchAllToInterpreted', (item: DebugConfigTreeItem) => {
            provider.switchStatus(item, false, true)
        }),
        vscode.commands.registerCommand('language-julia.refreshCompiled', () => {
            provider.refresh()
        }),
        vscode.commands.registerCommand('language-julia.apply-compiled-defaults', () => {
            provider.applyDefaults()
        }),
        vscode.commands.registerCommand('language-julia.reset-compiled', () => {
            provider.reset()
        }),
        onInit(connection => {
            provider.setConnection(connection)
            provider.refresh()
        }),
        onFinishEval(_ => provider.refresh()),
        onExit(e => {
            provider.setConnection(null)
            provider.refresh()
        }),
    )
    return provider
}

export function deactivate() { }
