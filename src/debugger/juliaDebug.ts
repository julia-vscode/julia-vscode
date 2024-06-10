// import { Subject } from 'await-notify'
// import * as net from 'net'
// import { basename, join } from 'path'
// import { uuid } from 'uuidv4'
// import * as vscode from 'vscode'
// import { InitializedEvent, Logger, logger, LoggingDebugSession, StoppedEvent, TerminatedEvent } from '@vscode/debugadapter'
// import { DebugProtocol } from '@vscode/debugprotocol'
// import { replStartDebugger } from '../interactive/repl'
// import { JuliaExecutable } from '../juliaexepath'
// import { getCrashReportingPipename } from '../telemetry'
// import { generatePipeName, inferJuliaNumThreads } from '../utils'



// export class JuliaDebugSession extends LoggingDebugSession {
//     private _configurationDone = new Subject()

//     // private _debuggeeTerminal: vscode.Terminal
//     private _task: vscode.TaskExecution

//     private _launchMode: boolean
//     private _launchedWithoutDebug: boolean

//     private _no_need_for_force_kill: boolean = false

//     protected ourFinishedEvent() {
//         this._no_need_for_force_kill = true
//         this.sendEvent(new TerminatedEvent())
//     }

// protected async attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments) {
//     this._launchMode = false
//     const pn = generatePipeName(uuid(), 'vsc-jl-dbg')

//     const connectedPromise = new Subject()
//     const serverListeningPromise = new Subject()

//     const server = net.createServer(socket => {
//         this._connection = createMessageConnection(
//             new StreamMessageReader(socket),
//             new StreamMessageWriter(socket)
//         )

//         this._connection.onNotification(notifyTypeStopped, (params) => this.sendEvent(new StoppedEvent(params.reason, params.threadId, params.text)))
//         this._connection.onNotification(notifyTypeOurFinished, () => this.ourFinishedEvent())

//         this._connection.listen()

//         connectedPromise.notify()
//     })

//     server.listen(pn, () => {
//         serverListeningPromise.notify()
//     })

//     await serverListeningPromise.wait()

//     replStartDebugger(pn)

//     await connectedPromise.wait()

//     // since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
//     // we request them early by sending an 'initializeRequest' to the frontend.
//     // The frontend will end the configuration sequence by calling 'configurationDone' request.
//     this.sendEvent(new InitializedEvent())

//     // wait until configuration has finished (and configurationDoneRequest has been called)
//     // await this._configurationDone.wait(1000);
//     await this._configurationDone.wait()

//     await this._connection.sendNotification(notifyTypeExec, {
//         stopOnEntry: args.stopOnEntry,
//         code: args.code,
//         file: args.file,
//         compiledModulesOrFunctions: args.compiledModulesOrFunctions,
//         compiledMode: args.compiledMode
//     })

//     this.sendResponse(response)
// }

// protected async runRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
//     const nthreads = inferJuliaNumThreads()
//     const jlargs = [
//         ...this.juliaExecutable.args,
//         '--color=yes',
//         `--project=${args.juliaEnv}`,
//         args.program,
//         ...(args.args ?? [])
//     ]

//     const env = {}

//     if (nthreads === 'auto') {
//         jlargs.splice(1, 0, '--threads=auto')
//     } else {
//         env['JULIA_NUM_THREADS'] = nthreads
//     }

//     const task = new vscode.Task(
//         {
//             type: 'julia',
//             id: uuid(),
//         },
//         vscode.TaskScope.Workspace,
//         `Run ${basename(args.program)}`,
//         'Julia',
//         new vscode.ProcessExecution(this.juliaExecutable.file, jlargs, {
//             env: env,
//             cwd: args.cwd,
//         })
//     )
//     this._task = await vscode.tasks.executeTask(task)

//     vscode.tasks.onDidEndTask(tee => {
//         if (tee.execution === this._task) {
//             this.sendEvent(new TerminatedEvent())
//         }
//     })

//     this.sendResponse(response)
// }

// protected async terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments) {
//     if (this._launchedWithoutDebug) {
//         this._task.terminate()
//         this.sendEvent(new TerminatedEvent())
//     }
//     else {
//         response.body = await this._connection.sendRequest(requestTypeTerminate, args)
//     }
//     this.sendResponse(response)
// }

// protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments) {
//     if (this._launchMode) {
//         if (!this._no_need_for_force_kill) {
//             this._task.terminate()
//         }
//     }
//     else {
//         response.body = await this._connection.sendRequest(requestTypeDisconnect, args)
//     }

//     this.sendResponse(response)
// }

// protected async customRequest(request: string, response: any, args: any) {
//     if (request === 'setCompiledItems') {
//         await this._connection.sendNotification(notifyTypeSetCompiledItems, args)
//     } else if (request === 'setCompiledMode') {
//         await this._connection.sendNotification(notifyTypeSetCompiledMode, args)
//     }
// }
// }
