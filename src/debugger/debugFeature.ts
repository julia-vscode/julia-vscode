import * as vscode from 'vscode'
import * as jlpkgenv from '../jlpkgenv'
import { getJuliaExePath } from '../juliaexepath'
import { registerCommand } from '../utils'
import { JuliaDebugSession } from './juliaDebug'

export class JuliaDebugFeature {
    constructor(private context: vscode.ExtensionContext, compiledProvider) {
        const provider = new JuliaDebugConfigurationProvider(compiledProvider)
        const factory = new InlineDebugAdapterFactory(this.context)

        compiledProvider.onDidChangeTreeData(() => {
            if (vscode.debug.activeDebugSession && vscode.debug.activeDebugSession.type === 'julia') {
                vscode.debug.activeDebugSession.customRequest('setCompiledItems', { compiledModulesOrFunctions: compiledProvider.getCompiledItems() })
            }
        })
        compiledProvider.onDidChangeCompiledMode(mode => {
            if (vscode.debug.activeDebugSession && vscode.debug.activeDebugSession.type === 'julia') {
                vscode.debug.activeDebugSession.customRequest('setCompiledMode', { compiledMode: mode })
            }
        })

        this.context.subscriptions.push(
            vscode.debug.registerDebugConfigurationProvider('julia', provider),
            vscode.debug.registerDebugAdapterDescriptorFactory('julia', factory),
            registerCommand('language-julia.debug.getActiveJuliaEnvironment', async config => {
                return await jlpkgenv.getAbsEnvPath()
            }),
            registerCommand('language-julia.runEditorContents', async (resource: vscode.Uri | undefined) => {
                resource = getActiveUri(resource)
                if (!resource) {
                    vscode.window.showInformationMessage('No active editor found.')
                    return
                }
                const folder = vscode.workspace.getWorkspaceFolder(resource)
                if (folder === undefined) {
                    vscode.window.showInformationMessage('File not found in workspace.')
                    return
                }
                const success = await vscode.debug.startDebugging(folder, {
                    type: 'julia',
                    name: 'Run Editor Contents',
                    request: 'launch',
                    program: resource.fsPath,
                    noDebug: true
                })
                if (!success) {
                    vscode.window.showErrorMessage('Could not run editor content in new process.')
                }
            }),
            registerCommand('language-julia.debugEditorContents', async (resource: vscode.Uri | undefined) => {
                resource = getActiveUri(resource)
                if (!resource) {
                    vscode.window.showInformationMessage('No active editor found.')
                    return
                }
                const folder = vscode.workspace.getWorkspaceFolder(resource)
                if (folder === undefined) {
                    vscode.window.showInformationMessage('File not found in workspace.')
                    return
                }
                const success = await vscode.debug.startDebugging(folder, {
                    type: 'julia',
                    name: 'Debug Editor Contents',
                    request: 'launch',
                    program: resource.fsPath,
                    compiledModulesOrFunctions: compiledProvider.getCompiledItems(),
                    compiledMode: compiledProvider.compiledMode
                })
                if (!success) {
                    vscode.window.showErrorMessage('Could not debug editor content in new process.')
                }
            })
        )
    }

    public dispose() { }
}

function getActiveUri(
    uri: vscode.Uri | undefined,
    editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor
) {
    return uri || (editor ? editor.document.uri : undefined)
}

export class JuliaDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    compiledProvider: any

    constructor(compiledProvider) {
        this.compiledProvider = compiledProvider
    }
    public resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        if (!config.request) {
            config.request = 'launch'
        }

        if (!config.type) {
            config.type = 'julia'
        }

        if (!config.name) {
            config.name = 'Launch Julia'
        }

        if (!config.program && config.request !== 'attach' && vscode.window.activeTextEditor) {
            config.program = vscode.window.activeTextEditor.document.fileName
        }

        if (!config.internalConsoleOptions) {
            config.internalConsoleOptions = 'neverOpen'
        }

        if (!config.stopOnEntry) {
            config.stopOnEntry = false
        }

        if (!config.compiledModulesOrFunctions && this.compiledProvider) {
            config.compiledModulesOrFunctions = this.compiledProvider.getCompiledItems()
        }

        if (!config.compiledMode && this.compiledProvider) {
            config.compiledMode = this.compiledProvider.compiledMode
        }

        if (!config.cwd && config.request !== 'attach') {
            config.cwd = '${workspaceFolder}'
        }

        if (!config.juliaEnv && config.request !== 'attach') {
            config.juliaEnv = '${command:activeJuliaEnvironment}'
        }

        console.log(config)

        return config
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
