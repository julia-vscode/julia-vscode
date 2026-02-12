import * as vscode from 'vscode'
import { ExtensionStatusManager } from './extensionStatus'
import { StatusPaneTreeProvider } from './statusPaneProvider'

export class StatusPaneFeature {
    private statusTreeView: vscode.TreeView<any>

    constructor(
        private context: vscode.ExtensionContext,
        public statusManager: ExtensionStatusManager
    ) {
        const statusTreeProvider = new StatusPaneTreeProvider(statusManager)
        this.statusTreeView = vscode.window.createTreeView('julia-extension-status', {
            treeDataProvider: statusTreeProvider
        })

        this.context.subscriptions.push(
            this.statusTreeView,
            vscode.commands.registerCommand('language-julia.refreshExtensionStatus', () => {
                statusTreeProvider.refresh()
            })
        )
    }

    public dispose() {
        this.statusTreeView.dispose()
    }
}
