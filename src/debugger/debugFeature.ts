import * as vscode from 'vscode'
import * as jlpkgenv from '../jlpkgenv'
import { JuliaExecutablesFeature } from '../juliaexepath'
import { generatePipeName, inferJuliaNumThreads, registerCommand } from '../utils'
import { uuid } from 'uuidv4'
import { Subject } from 'await-notify'
import * as net from 'net'
import { join } from 'path'
import { getCrashReportingPipename } from '../telemetry'

// /**
//  * This interface describes the Julia specific launch attributes
//  * (which are not part of the Debug Adapter Protocol).
//  * The schema for these attributes lives in the package.json of the Julia extension.
//  * The interface should always match this schema.
//  */
// interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
//     /** An absolute path to the "program" to debug. */
//     program: string
//     /** Automatically stop target after launch. If not specified, target does not stop. */
//     stopOnEntry?: boolean
//     cwd?: string
//     juliaEnv?: string
//     /** enable logging the Debug Adapter Protocol */
//     trace?: boolean
//     args?: string[]
//     compiledModulesOrFunctions?: string[]
//     compiledMode?: Boolean
// }

// interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
//     code: string
//     file: string
//     stopOnEntry: boolean
//     compiledModulesOrFunctions?: string[]
//     compiledMode?: Boolean
// }

export class JuliaDebugFeature {
    public debugSession2Task: WeakMap<vscode.DebugSession, vscode.TaskExecution> = new WeakMap<vscode.DebugSession, vscode.TaskExecution>()
    public taskExecution2ProcessId: WeakMap<vscode.TaskExecution, number> = new WeakMap<vscode.TaskExecution, number>()

    constructor(private context: vscode.ExtensionContext, compiledProvider, juliaExecutablesFeature: JuliaExecutablesFeature) {
        const provider = new JuliaDebugConfigurationProvider(compiledProvider)
        const factory = new InlineDebugAdapterFactory(this.context, this, juliaExecutablesFeature)

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

        vscode.tasks.onDidStartTaskProcess(e => this.taskExecution2ProcessId.set(e.execution, e.processId))

        vscode.debug.onDidTerminateDebugSession((debugSession: vscode.DebugSession) => {
            const taskExecution = this.debugSession2Task.get(debugSession)
            const procid = this.taskExecution2ProcessId.get(taskExecution)

            this.debugSession2Task.delete(debugSession)
            this.taskExecution2ProcessId.delete(taskExecution)

            // If the debug process did not terminate, we kill it here
            try {
                process.kill(procid)
            }
            catch(err) {
            }
        },
        this,
        this.context.subscriptions
        )

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

    constructor(private context: vscode.ExtensionContext, private juliaDebugFeature: JuliaDebugFeature, private juliaExecutablesFeature: JuliaExecutablesFeature) {
    }

    async createDebugAdapterDescriptor(session: vscode.DebugSession): Promise<vscode.ProviderResult<vscode.DebugAdapterDescriptor>> {
        if(session.configuration.request=='launch') {
            const dap_pn = generatePipeName(uuid(), 'vsc-jl-dbg')
            const ready_pn = generatePipeName(uuid(), 'vsc-jl-dbg')

            const connectedPromise = new Subject()
            const serverListeningPromise = new Subject()

            const readyServer = net.createServer(socket => {
                connectedPromise.notify()
            })

            readyServer.listen(ready_pn, () => {
                serverListeningPromise.notify()
            })

            await serverListeningPromise.wait()

            const juliaExecutable = await this.juliaExecutablesFeature.getActiveJuliaExecutableAsync()

            const nthreads = inferJuliaNumThreads()
            const jlargs = [
                ...juliaExecutable.args,
                '--color=yes',
                '--startup-file=no',
                '--history-file=no',
                // `--project=${args.juliaEnv}`,
                join(
                    this.context.extensionPath,
                    'scripts',
                    'debugger',
                    'run_debugger.jl'
                ),
                ready_pn,
                dap_pn,
                getCrashReportingPipename(),
            ]

            const env = {
            // JL_ARGS: args.args
            //     ? args.args.map((i) => Buffer.from(i).toString('base64')).join(';')
            //     : '',
            }

            if (nthreads === 'auto') {
                jlargs.splice(1, 0, '--threads=auto')
            } else {
                env['JULIA_NUM_THREADS'] = nthreads
            }

            const task = new vscode.Task(
                {
                    type: 'julia',
                    id: uuid(),
                },
                vscode.TaskScope.Workspace,
                // TODO `Debug ${basename(args.program)}`,
                'something',
                'Julia',

                new vscode.ProcessExecution(juliaExecutable.file, jlargs, {
                    env: env,
                // TODO cwd: args.cwd,
                })
            )
            task.presentationOptions.echo = false

            const task2 = await vscode.tasks.executeTask(task)

            this.juliaDebugFeature.debugSession2Task.set(session, task2)

            await connectedPromise.wait()

            return new vscode.DebugAdapterNamedPipeServer(dap_pn)
        }
        else if(session.configuration.request === 'attach') {
            return new vscode.DebugAdapterNamedPipeServer(session.configuration.pipename)
        }
    }
}
