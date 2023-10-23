import { Subject } from 'await-notify'
import * as net from 'net'
import { basename, join } from 'path'
import { uuid } from 'uuidv4'
import * as vscode from 'vscode'
import { InitializedEvent, Logger, logger, LoggingDebugSession, StoppedEvent, TerminatedEvent } from '@vscode/debugadapter'
import { DebugProtocol } from '@vscode/debugprotocol'
import { createMessageConnection, MessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'
import { replStartDebugger } from '../interactive/repl'
import { JuliaExecutable } from '../juliaexepath'
import { getCrashReportingPipename } from '../telemetry'
import { generatePipeName, inferJuliaNumThreads } from '../utils'
import { notifyTypeDebug, notifyTypeExec, notifyTypeOurFinished, notifyTypeRun, notifyTypeSetCompiledItems, notifyTypeSetCompiledMode, notifyTypeStopped, requestTypeBreakpointLocations, requestTypeContinue, requestTypeDisconnect, requestTypeEvaluate, requestTypeExceptionInfo, requestTypeNext, requestTypeRestartFrame, requestTypeScopes, requestTypeSetBreakpoints, requestTypeSetExceptionBreakpoints, requestTypeSetFunctionBreakpoints, requestTypeSetVariable, requestTypeSource, requestTypeStackTrace, requestTypeStepIn, requestTypeStepInTargets, requestTypeStepOut, requestTypeTerminate, requestTypeThreads, requestTypeVariables, requestTypeCompletions } from './debugProtocol'

/**
 * This interface describes the Julia specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the Julia extension.
 * The interface should always match this schema.
 */
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** An absolute path to the "program" to debug. */
    program: string
    /** Automatically stop target after launch. If not specified, target does not stop. */
    stopOnEntry?: boolean
    cwd?: string
    juliaEnv?: string
    /** enable logging the Debug Adapter Protocol */
    trace?: boolean
    args?: string[]
    compiledModulesOrFunctions?: string[]
    compiledMode?: Boolean
}

interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
    code: string
    file: string
    stopOnEntry: boolean
    compiledModulesOrFunctions?: string[]
    compiledMode?: Boolean
}

export class JuliaDebugSession extends LoggingDebugSession {
    private _configurationDone = new Subject()

    // private _debuggeeTerminal: vscode.Terminal
    private _task: vscode.TaskExecution
    private _connection: MessageConnection

    private _launchMode: boolean
    private _launchedWithoutDebug: boolean

    private _no_need_for_force_kill: boolean = false

    /**
     * Creates a new debug adapter that is used for one debug session.
     * We configure the default implementation of a debug adapter here.
     */
    public constructor(private context: vscode.ExtensionContext, private juliaExecutable: JuliaExecutable) {
        super('julia-debug.txt')

        // this debugger uses zero-based lines and columns
        this.setDebuggerLinesStartAt1(true)
        this.setDebuggerColumnsStartAt1(true)
    }

    /**
     * The 'initialize' request is the first request called by the frontend
     * to interrogate the features the debug adapter provides.
     */
    protected async initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): Promise<void> {

        // build and return the capabilities of this debug adapter:
        response.body = response.body || {}

        // the adapter implements the configurationDoneRequest.
        response.body.supportsConfigurationDoneRequest = true

        response.body.supportsFunctionBreakpoints = true

        // make VS Code to use 'evaluate' when hovering over source
        response.body.supportsEvaluateForHovers = true

        // make VS Code to show a 'step back' button
        response.body.supportsStepBack = false

        // make VS Code to support data breakpoints
        response.body.supportsDataBreakpoints = false

        // make VS Code to support completion in REPL
        response.body.supportsCompletionsRequest = true
        // response.body.completionTriggerCharacters = [".", "["];

        // make VS Code to send cancelRequests
        response.body.supportsCancelRequest = false

        response.body.supportsTerminateRequest = true

        // make VS Code send the breakpointLocations request
        response.body.supportsBreakpointLocationsRequest = false

        response.body.supportsConditionalBreakpoints = true

        response.body.supportsHitConditionalBreakpoints = false

        response.body.supportsLogPoints = false

        response.body.supportsExceptionInfoRequest = true

        response.body.supportsRestartFrame = true

        response.body.supportsSetVariable = true

        response.body.supportsStepInTargetsRequest = true

        response.body.exceptionBreakpointFilters = [
            { filter: 'error', label: 'Uncaught Exceptions', default: true },
            { filter: 'throw', label: 'All Exceptions', default: false }
        ]

        this.sendResponse(response)
    }

    /**
     * Called at the end of the configuration sequence.
     * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
     */
    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
        super.configurationDoneRequest(response, args)

        // notify the launchRequest that configuration has finished
        this._configurationDone.notify()
    }

    protected ourFinishedEvent() {
        this._no_need_for_force_kill = true
        this.sendEvent(new TerminatedEvent())
    }

    protected async attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments) {
        this._launchMode = false
        const pn = generatePipeName(uuid(), 'vsc-jl-dbg')

        const connectedPromise = new Subject()
        const serverListeningPromise = new Subject()

        const server = net.createServer(socket => {
            this._connection = createMessageConnection(
                new StreamMessageReader(socket),
                new StreamMessageWriter(socket)
            )

            this._connection.onNotification(notifyTypeStopped, (params) => this.sendEvent(new StoppedEvent(params.reason, params.threadId, params.text)))
            this._connection.onNotification(notifyTypeOurFinished, () => this.ourFinishedEvent())

            this._connection.listen()

            connectedPromise.notify()
        })

        server.listen(pn, () => {
            serverListeningPromise.notify()
        })

        await serverListeningPromise.wait()

        replStartDebugger(pn)

        await connectedPromise.wait()

        // since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
        // we request them early by sending an 'initializeRequest' to the frontend.
        // The frontend will end the configuration sequence by calling 'configurationDone' request.
        this.sendEvent(new InitializedEvent())

        // wait until configuration has finished (and configurationDoneRequest has been called)
        // await this._configurationDone.wait(1000);
        await this._configurationDone.wait()

        await this._connection.sendNotification(notifyTypeExec, {
            stopOnEntry: args.stopOnEntry,
            code: args.code,
            file: args.file,
            compiledModulesOrFunctions: args.compiledModulesOrFunctions,
            compiledMode: args.compiledMode
        })

        this.sendResponse(response)
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
        this._launchMode = true
        // make sure to 'Stop' the buffered logging if 'trace' is not set
        logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false)

        if (args.noDebug) {
            return this.runRequest(response, args)
        }

        const connectedPromise = new Subject()
        const serverListeningPromise = new Subject()

        const pn = generatePipeName(uuid(), 'vsc-jl-dbg')

        const server = net.createServer(socket => {
            this._connection = createMessageConnection(
                new StreamMessageReader(socket),
                new StreamMessageWriter(socket)
            )

            this._connection.onNotification(notifyTypeStopped, (params) => this.sendEvent(new StoppedEvent(params.reason, params.threadId, params.text)))
            this._connection.onNotification(notifyTypeOurFinished, () => this.ourFinishedEvent())

            this._connection.listen()

            connectedPromise.notify()
        })

        server.listen(pn, () => {
            serverListeningPromise.notify()
        })

        await serverListeningPromise.wait()

        const nthreads = inferJuliaNumThreads()
        const jlargs = [
            ...this.juliaExecutable.args,
            '--color=yes',
            '--startup-file=no',
            '--history-file=no',
            `--project=${args.juliaEnv}`,
            join(
                this.context.extensionPath,
                'scripts',
                'debugger',
                'run_debugger.jl'
            ),
            pn,
            getCrashReportingPipename(),
        ]

        const env = {
            JL_ARGS: args.args
                ? args.args.map((i) => Buffer.from(i).toString('base64')).join(';')
                : '',
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
            `Debug ${basename(args.program)}`,
            'Julia',

            new vscode.ProcessExecution(this.juliaExecutable.file, jlargs, {
                env: env,
                cwd: args.cwd,
            })
        )
        this._task = await vscode.tasks.executeTask(task)

        vscode.tasks.onDidEndTask(tee => {
            if (tee.execution === this._task) {
                this.sendEvent(new TerminatedEvent())
            }
        })

        await connectedPromise.wait()

        // since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
        // we request them early by sending an 'initializeRequest' to the frontend.
        // The frontend will end the configuration sequence by calling 'configurationDone' request.
        this.sendEvent(new InitializedEvent())

        // wait until configuration has finished (and configurationDoneRequest has been called)
        // await this._configurationDone.wait(1000);
        await this._configurationDone.wait()

        this._launchedWithoutDebug = args.noDebug ?? false

        if (args.noDebug) {
            await this._connection.sendNotification(notifyTypeRun, { program: args.program })
        } else {
            await this._connection.sendNotification(notifyTypeDebug, {
                stopOnEntry: args.stopOnEntry ?? false,
                program: args.program,
                compiledModulesOrFunctions: args.compiledModulesOrFunctions,
                compiledMode: args.compiledMode
            })
        }

        this.sendResponse(response)
    }

    protected async runRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
        const nthreads = inferJuliaNumThreads()
        const jlargs = [
            ...this.juliaExecutable.args,
            '--color=yes',
            `--project=${args.juliaEnv}`,
            args.program,
            ...(args.args ?? [])
        ]

        const env = {}

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
            `Run ${basename(args.program)}`,
            'Julia',
            new vscode.ProcessExecution(this.juliaExecutable.file, jlargs, {
                env: env,
                cwd: args.cwd,
            })
        )
        this._task = await vscode.tasks.executeTask(task)

        vscode.tasks.onDidEndTask(tee => {
            if (tee.execution === this._task) {
                this.sendEvent(new TerminatedEvent())
            }
        })

        this.sendResponse(response)
    }

    protected async terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments) {
        if (this._launchedWithoutDebug) {
            this._task.terminate()
            this.sendEvent(new TerminatedEvent())
        }
        else {
            response.body = await this._connection.sendRequest(requestTypeTerminate, args)
        }
        this.sendResponse(response)
    }

    protected async disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments) {
        if (this._launchMode) {
            if (!this._no_need_for_force_kill) {
                this._task.terminate()
            }
        }
        else {
            response.body = await this._connection.sendRequest(requestTypeDisconnect, args)
        }

        this.sendResponse(response)
    }

    // Pure relay below

    protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments) {
        try {
            response.body = await this._connection.sendRequest(requestTypeSetVariable, args)
        }
        catch (err) {
            response.success = false
            response.message = err.message
        }
        this.sendResponse(response)
    }

    protected async breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments) {
        response.body = await this._connection.sendRequest(requestTypeBreakpointLocations, args)
        this.sendResponse(response)
    }

    protected async threadsRequest(response: DebugProtocol.ThreadsResponse) {
        response.body = await this._connection.sendRequest(requestTypeThreads)
        this.sendResponse(response)
    }

    protected async completionsRequest(response: DebugProtocol.CompletionsResponse, args: DebugProtocol.CompletionsArguments) {
        response.body = await this._connection.sendRequest(requestTypeCompletions, args)
        this.sendResponse(response)
    }

    protected async setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments) {
        response.body = await this._connection.sendRequest(requestTypeSetBreakpoints, args)
        this.sendResponse(response)
    }

    protected async setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments) {
        response.body = await this._connection.sendRequest(requestTypeSetFunctionBreakpoints, args)
        this.sendResponse(response)
    }

    protected async setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments) {
        response.body = await this._connection.sendRequest(requestTypeSetExceptionBreakpoints, args)
        this.sendResponse(response)
    }

    protected async continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments) {
        response.body = await this._connection.sendRequest(requestTypeContinue, args)
        this.sendResponse(response)
    }

    protected async nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments) {
        response.body = await this._connection.sendRequest(requestTypeNext, args)
        this.sendResponse(response)
    }

    protected async stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments) {
        response.body = await this._connection.sendRequest(requestTypeStepIn, args)
        this.sendResponse(response)
    }
    protected async stepInTargetsRequest(response: DebugProtocol.StepInTargetsResponse, args: DebugProtocol.StepInTargetsArguments) {
        response.body = await this._connection.sendRequest(requestTypeStepInTargets, args)
        this.sendResponse(response)
    }

    protected async stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments) {
        response.body = await this._connection.sendRequest(requestTypeStepOut, args)
        this.sendResponse(response)
    }

    protected async restartFrameRequest(response: DebugProtocol.RestartFrameResponse, args: DebugProtocol.RestartFrameArguments) {
        response.body = await this._connection.sendRequest(requestTypeRestartFrame, args)
        this.sendResponse(response)
    }

    protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {
        response.body = await this._connection.sendRequest(requestTypeEvaluate, args)
        this.sendResponse(response)
    }

    protected async exceptionInfoRequest(response: DebugProtocol.ExceptionInfoResponse, args: DebugProtocol.ExceptionInfoArguments) {
        response.body = await this._connection.sendRequest(requestTypeExceptionInfo, args)
        this.sendResponse(response)
    }

    protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments) {
        response.body = await this._connection.sendRequest(requestTypeStackTrace, args)
        this.sendResponse(response)
    }

    protected async sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments) {
        response.body = await this._connection.sendRequest(requestTypeSource, args)
        this.sendResponse(response)
    }

    protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments) {
        response.body = await this._connection.sendRequest(requestTypeScopes, args)
        this.sendResponse(response)
    }

    protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments) {
        response.body = await this._connection.sendRequest(requestTypeVariables, args)
        this.sendResponse(response)
    }

    protected async customRequest(request: string, response: any, args: any) {
        if (request === 'setCompiledItems') {
            await this._connection.sendNotification(notifyTypeSetCompiledItems, args)
        } else if (request === 'setCompiledMode') {
            await this._connection.sendNotification(notifyTypeSetCompiledMode, args)
        }
    }
}
