import { Subject } from 'await-notify'
import * as net from 'net'
import { join } from 'path'
import { uuid } from 'uuidv4'
import * as vscode from 'vscode'
import { InitializedEvent, Logger, logger, LoggingDebugSession, StoppedEvent, TerminatedEvent } from 'vscode-debugadapter'
import { DebugProtocol } from 'vscode-debugprotocol'
import { createMessageConnection, Disposable, MessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc'
import { replStartDebugger } from '../interactive/repl'
import { getCrashReportingPipename } from '../telemetry'
import { generatePipeName } from '../utils'
import { notifyTypeDebug, notifyTypeExec, notifyTypeOurFinished, notifyTypeRun, notifyTypeStopped, requestTypeBreakpointLocations, requestTypeContinue, requestTypeDisconnect, requestTypeEvaluate, requestTypeExceptionInfo, requestTypeNext, requestTypeRestartFrame, requestTypeScopes, requestTypeSetBreakpoints, requestTypeSetExceptionBreakpoints, requestTypeSetFunctionBreakpoints, requestTypeSetVariable, requestTypeSource, requestTypeStackTrace, requestTypeStepIn, requestTypeStepInTargets, requestTypeStepOut, requestTypeTerminate, requestTypeThreads, requestTypeVariables } from './debugProtocol'

/**
 * This interface describes the Julia specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the Julia extension.
 * The interface should always match this schema.
 */
interface LaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
    /** An absolute path to the "program" to debug. */
    program: string;
    /** Automatically stop target after launch. If not specified, target does not stop. */
    stopOnEntry?: boolean;
    cwd?: string;
    juliaEnv?: string,
    /** enable logging the Debug Adapter Protocol */
    trace?: boolean;
    args?: string[];
}

interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
    code: string;
    stopOnEntry: boolean;
}

export class JuliaDebugSession extends LoggingDebugSession {
    private _configurationDone = new Subject();

    private _debuggeeTerminal: vscode.Terminal;
    private _connection: MessageConnection;
    private _debuggeeWrapperSocket: net.Socket;

    private _launchMode: boolean;
    private _launchedWithoutDebug: boolean;

    private _no_need_for_force_kill: boolean = false;

    /**
     * Creates a new debug adapter that is used for one debug session.
     * We configure the default implementation of a debug adapter here.
     */
    public constructor(private context: vscode.ExtensionContext, private juliaPath: string) {
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
        response.body.supportsCompletionsRequest = false
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
            { filter: 'compilemode', label: 'Compiled Mode (experimental)', default: false },
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


        const code_to_run = args.code

        this._connection.sendNotification(notifyTypeExec, { stopOnEntry: args.stopOnEntry, code: code_to_run })

        this.sendResponse(response)
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
        this._launchMode = true
        // make sure to 'Stop' the buffered logging if 'trace' is not set
        logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false)

        const connectedPromise = new Subject()
        const serverListeningPromise = new Subject()
        const serverForWrapperPromise = new Subject()

        const pn = generatePipeName(uuid(), 'vsc-jl-dbg')
        const pnForWrapper = generatePipeName(uuid(), 'vsc-jl-dbgw')

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

        const serverForWrapper = net.createServer(socket => {
            this._debuggeeWrapperSocket = socket
        })

        serverForWrapper.listen(pnForWrapper, () => {
            serverForWrapperPromise.notify()
        })

        await serverForWrapperPromise.wait()

        server.listen(pn, () => {
            serverListeningPromise.notify()
        })

        await serverListeningPromise.wait()

        this._debuggeeTerminal = vscode.window.createTerminal({
            name: 'Julia Debugger',
            shellPath: this.juliaPath,
            shellArgs: [
                '--color=yes',
                '--startup-file=no',
                '--history-file=no',
                join(this.context.extensionPath, 'scripts', 'debugger', 'launch_wrapper.jl'),
                pn,
                pnForWrapper,
                args.cwd,
                args.juliaEnv,
                getCrashReportingPipename()
            ],
            env: {
                JL_ARGS: args.args ? args.args.map(i => Buffer.from(i).toString('base64')).join(';') : ''
            }
        })
        this._debuggeeTerminal.show(false)
        const disposables: Array<Disposable> = []
        vscode.window.onDidCloseTerminal((terminal) => {
            if (terminal === this._debuggeeTerminal) {
                this.sendEvent(new TerminatedEvent())
                disposables.forEach(d => d.dispose())
            }
        }, this, disposables)

        await connectedPromise.wait()

        // since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
        // we request them early by sending an 'initializeRequest' to the frontend.
        // The frontend will end the configuration sequence by calling 'configurationDone' request.
        this.sendEvent(new InitializedEvent())

        // wait until configuration has finished (and configurationDoneRequest has been called)
        // await this._configurationDone.wait(1000);
        await this._configurationDone.wait()

        this._launchedWithoutDebug = args.noDebug

        if (args.noDebug) {
            this._connection.sendNotification(notifyTypeRun, args.program)
        }
        else {
            this._connection.sendNotification(notifyTypeDebug, { stopOnEntry: args.stopOnEntry, program: args.program })
        }

        this.sendResponse(response)
    }

    protected async terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments) {
        if (this._launchedWithoutDebug) {
            this._debuggeeWrapperSocket.write('TERMINATE\n')
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
                this._debuggeeWrapperSocket.write('TERMINATE\n')
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
}
