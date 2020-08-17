import * as vscode from 'vscode'
import { getEnvPath } from '../jlpkgenv'
import { getJuliaExePath } from '../juliaexepath'
import { JuliaDebugSession } from './juliaDebug'

export class JuliaDebugFeature {
    constructor(private context: vscode.ExtensionContext) {
        const provider = new JuliaDebugConfigurationProvider()
        const factory = new InlineDebugAdapterFactory(this.context)

        this.context.subscriptions.push(
            vscode.debug.registerDebugConfigurationProvider('julia', provider),
            vscode.debug.registerDebugAdapterDescriptorFactory('julia', factory),
            vscode.commands.registerCommand('language-julia.debug.getActiveJuliaEnvironment', async config => {
                const pkgenvpath = await getEnvPath()
                return pkgenvpath
            }),
            vscode.commands.registerCommand('language-julia.runEditorContents', (resource: vscode.Uri | undefined) => {
                const program = getActiveUri(resource)
                if (!program) {
                    vscode.window.showInformationMessage('No active editor found.')
                    return
                }
                vscode.debug.startDebugging(undefined, {
                    type: 'julia',
                    name: 'Run Editor Contents',
                    request: 'launch',
                    program,
                    noDebug: true
                },/* upcoming proposed API:
				{
					noDebug: true
				}
			*/)
            }),
            vscode.commands.registerCommand('language-julia.debugEditorContents', (resource: vscode.Uri | undefined) => {
                const program = getActiveUri(resource)
                if (!program) {
                    vscode.window.showInformationMessage('No active editor found.')
                    return
                }
                vscode.debug.startDebugging(undefined, {
                    type: 'julia',
                    name: 'Debug Editor Contents',
                    request: 'launch',
                    program
                })
            })
        )
    }

    public dispose() { }
}

function getActiveUri(
    uri: vscode.Uri | undefined,
    editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor
) {
    return uri ? uri.fsPath : editor ? editor.document.fileName : undefined
}

export class JuliaDebugConfigurationProvider implements vscode.DebugConfigurationProvider {

    public resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.DebugConfiguration> {

        return (async () => {
            if (!config.request) {
                config.request = 'launch'
            }

            if (!config.type) {
                config.type = 'julia'
            }

            if (!config.name) {
                config.name = 'Launch Julia'
            }

            if (!config.program && config.request !== 'attach') {
                config.program = vscode.window.activeTextEditor.document.fileName
            }

            if (!config.internalConsoleOptions) {
                config.internalConsoleOptions = 'neverOpen'
            }

            if (!config.stopOnEntry) {
                config.stopOnEntry = false
            }

            if (!config.cwd && config.request !== 'attach') {
                config.cwd = '${workspaceFolder}'
            }

            if (!config.juliaEnv && config.request !== 'attach') {
                config.juliaEnv = '${command:activeJuliaEnvironment}'
            }

            return config
        })()
    }

}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {

    constructor(private context: vscode.ExtensionContext) { }

    createDebugAdapterDescriptor(_session: vscode.DebugSession): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        return (async () => {
            return new vscode.DebugAdapterInlineImplementation(<any>new JuliaDebugSession(this.context, await getJuliaExePath()))
        })()
    }
}
