import { Subject } from 'await-notify'
import * as net from 'net'
import { basename, join } from 'path'
import * as readline from 'readline'
import { uuid } from 'uuidv4'
import * as vscode from 'vscode'
import { Breakpoint, InitializedEvent, Logger, logger, LoggingDebugSession, Scope, Source, StackFrame, StoppedEvent, TerminatedEvent, Thread } from 'vscode-debugadapter'
import { DebugProtocol } from 'vscode-debugprotocol'
import { replStartDebugger } from './interactive/repl'
import { getCrashReportingPipename } from './telemetry'
import { generatePipeName } from './utils'


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
	console: 'integratedTerminal' | 'externalTerminal';
}

interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
	code: string;
	stopOnEntry: boolean;
}

export class JuliaDebugSession extends LoggingDebugSession {

	// we don't support multiple threads, so we can use a hardcoded ID for the default thread
	private static THREAD_ID = 1;

	private _configurationDone = new Subject();

	private _cancelationTokens = new Map<number, boolean>();

	private _juliaPath: string;
	private _context: vscode.ExtensionContext;

	private _debuggeeSocket: net.Socket;

	private _launchMode: boolean;
	private _launchedWithoutDebug: boolean;

	private _nextRequestId: number = 0;

	private _requestResponses: Map<number, { requestArrived: any, data: string }> = new Map<number, { requestArrived: any, data: string }>();

	private _no_need_for_force_kill: boolean = false;

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor(context: vscode.ExtensionContext, juliaPath: string) {
	    super('julia-debug.txt')
	    this._context = context
	    this._juliaPath = juliaPath

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

	    response.body.exceptionBreakpointFilters = [
	        { filter: 'compilemode', label: 'Enable compile mode (experimental)', default: false },
	        { filter: 'error', label: 'Break any time an uncaught exception is thrown', default: true },
	        { filter: 'throw', label: 'Break any time a throw is executed', default: false }
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

	protected sendNotificationToDebugger(cmd: string, body: string = '') {
	    const encoded_body = Buffer.from(body).toString('base64')

	    this._debuggeeSocket.write(`notification:${cmd}:${encoded_body}\n`)
	}

	protected async sendRequestToDebugger(cmd: string, body: string = ''): Promise<string> {
	    const requestId = this._nextRequestId
	    this._nextRequestId += 1

	    const responseArrived = new Subject()

	    this._requestResponses[requestId] = { requestArrived: responseArrived, data: '' }

	    const encoded_body = Buffer.from(body).toString('base64')

	    this._debuggeeSocket.write(`${requestId}:${cmd}:${encoded_body}\n`)

	    await responseArrived.wait()

	    const response = this._requestResponses[requestId].data

	    this._requestResponses.delete(requestId)

	    return response
	}

	protected processMsgFromDebugger(line: string) {
	    const parts = line.split(':')
	    const msg_cmd = parts[0]
	    const msg_id = parts[1]
	    const msg_body = Buffer.from(parts[2], 'base64').toString()

	    if (msg_cmd === 'STOPPEDBP') {
	        this.sendEvent(new StoppedEvent('breakpoint', JuliaDebugSession.THREAD_ID))
	    }
	    else if (msg_cmd === 'STOPPEDSTEP') {
	        this.sendEvent(new StoppedEvent('step', JuliaDebugSession.THREAD_ID))
	    }
	    else if (msg_cmd === 'STOPPEDEXCEPTION') {
	        this.sendEvent(new StoppedEvent('exception', JuliaDebugSession.THREAD_ID, msg_body))
	    }
	    else if (msg_cmd === 'STOPPEDFUNCBP') {
	        this.sendEvent(new StoppedEvent('function breakpoint', JuliaDebugSession.THREAD_ID))
	    }
	    else if (msg_cmd === 'STOPPEDENTRY') {
	        this.sendEvent(new StoppedEvent('entry', JuliaDebugSession.THREAD_ID))
	    }
	    else if (msg_cmd === 'FINISHED') {
	        this._no_need_for_force_kill = true
	        this.sendEvent(new TerminatedEvent())
	    }
	    else if (msg_cmd === 'RESPONSE') {
	        this._requestResponses[parseInt(msg_id)].data = msg_body
	        this._requestResponses[parseInt(msg_id)].requestArrived.notify()
	    }
	    else {
	        throw 'Unknown message received'
	    }
	}

	protected async attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments) {
	    this._launchMode = false
	    const pn = generatePipeName(uuid(), 'vsc-jl-dbg')

	    const connectedPromise = new Subject()
	    const serverListeningPromise = new Subject()

	    const server = net.createServer(socket => {
	        this._debuggeeSocket = socket
	        const rl = readline.createInterface(socket)

	        rl.on('line', this.processMsgFromDebugger.bind(this))

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

	    this.sendNotificationToDebugger('EXEC', `${args.stopOnEntry ? 'stopOnEntry=true' : 'stopOnEntry=false'};${code_to_run}`)

	    this.sendResponse(response)
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
	    this._launchMode = true
	    // make sure to 'Stop' the buffered logging if 'trace' is not set
	    logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false)

	    const connectedPromise = new Subject()
	    const serverListeningPromise = new Subject()

	    const pn = generatePipeName(uuid(), 'vsc-jl-dbg')

	    const server = net.createServer(socket => {
	        this._debuggeeSocket = socket
	        const rl = readline.createInterface(socket)

	        rl.on('line', this.processMsgFromDebugger.bind(this))

	        connectedPromise.notify()
	    })

	    server.listen(pn, () => {
	        serverListeningPromise.notify()
	    })

	    await serverListeningPromise.wait()

	    const foo = args.args ? args.args.map(i => Buffer.from(i).toString('base64')).join(';') : ''

	    this.runInTerminalRequest(
	        {
	            kind: args.console === 'integratedTerminal' ? 'integrated' : (args.console === 'externalTerminal' ? 'external' : undefined),
	            title: 'Julia Debugger',
	            cwd: args.cwd,
	            args: [
	                this._juliaPath,
	                '--color=yes',
	                '--history-file=no',
	                '--startup-file=no',
	                `--project=${args.juliaEnv}`,
	                join(this._context.extensionPath, 'scripts', 'debugger', 'run_debugger.jl'),
	                pn,
	                getCrashReportingPipename()
	            ],
	            env: {
	                JL_ARGS: foo
	            }
	        },
	        0, ()=>{return})

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
	        this.sendNotificationToDebugger('RUN', args.program)
	    }
	    else {
	        this.sendNotificationToDebugger('DEBUG', `${args.stopOnEntry ? 'stopOnEntry=true' : 'stopOnEntry=false'};${args.program}`)
	    }

	    this.sendResponse(response)
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {

	    const path = <string>args.source.path

	    let msgForClient = path

	    for (const i of args.breakpoints) {
	        const condition_text = i.condition ? i.condition : ''
	        const encoded_condition = Buffer.from(condition_text).toString('base64')
	        msgForClient = msgForClient + `;${i.line}:${encoded_condition}`
	    }
	    this.sendNotificationToDebugger('SETBREAKPOINTS', msgForClient)

	    // clear all breakpoints for this file
	    // this._runtime.clearBreakpoints(path);

	    // set and verify breakpoint locations
	    // const actualBreakpoints = clientLines.map(l => {
	    // 	let { verified, line, id } = this._runtime.setBreakPoint(path, this.convertClientLineToDebugger(l));
	    // 	const bp = <DebugProtocol.Breakpoint>new Breakpoint(verified, this.convertDebuggerLineToClient(line));
	    // 	bp.id = id;
	    // 	return bp;
	    // });

	    // send back the actual breakpoint positions
	    response.body = {
	        // breakpoints: actualBreakpoints
	        breakpoints: args.breakpoints.map(i => new Breakpoint(true))
	    }
	    this.sendResponse(response)
	}

	protected setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments): void {
	    const msgForClient = args.breakpoints.map(i => {
	        const encoded_name = Buffer.from(i.name).toString('base64')

	        const condition_text = i.condition ? i.condition : ''
	        const encoded_condition = Buffer.from(condition_text).toString('base64')
	        return `${encoded_name}:${encoded_condition}`
	    }).join(';')

	    this.sendNotificationToDebugger('SETFUNCBREAKPOINTS', msgForClient)

	    response.body = {
	        breakpoints: args.breakpoints.map(i => new Breakpoint(true))
	    }

	    this.sendResponse(response)
	}

	protected setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments): void {
	    this.sendNotificationToDebugger('SETEXCEPTIONBREAKPOINTS', args.filters.join(';'))

	    this.sendResponse(response)
	}

	protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request): void {

	    // if (args.source.path) {
	    // 	const bps = this._runtime.getBreakpoints(args.source.path, this.convertClientLineToDebugger(args.line));
	    // 	response.body = {
	    // 		breakpoints: bps.map(col => {
	    // 			return {
	    // 				line: args.line,
	    // 				column: this.convertDebuggerColumnToClient(col)
	    // 			}
	    // 		})
	    // 	};
	    // } else {
	    // 	response.body = {
	    // 		breakpoints: []
	    // 	};
	    // }

	    response.body = {
	        breakpoints: []
	    }

	    this.sendResponse(response)
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {

	    // runtime supports no threads so just return a default thread.
	    response.body = {
	        threads: [
	            new Thread(JuliaDebugSession.THREAD_ID, 'thread 1')
	        ]
	    }
	    this.sendResponse(response)
	}

	protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments) {
	    const resp = await this.sendRequestToDebugger('GETSTACKTRACE')
	    const stk = resp.split('\n')



	    // const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
	    // const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
	    // const endFrame = startFrame + maxLevels;

	    // const stk = this._runtime.stack(startFrame, endFrame);

	    response.body = {
	        stackFrames: stk.map(f => {
	            const parts = f.split(';')

	            if (parts[2] === 'path') {
	                // TODO Figure out how we can get a proper stackframe ID
	                // TODO Make sure ; is a good separator here...
	                return new StackFrame(parseInt(parts[0]), parts[1], this.createSource(parts[3]), this.convertDebuggerLineToClient(parseInt(parts[4])), 1)
	            }
	            else {
	                return new StackFrame(
	                    parseInt(parts[0]),
	                    parts[1],
	                    new Source(parts[4], undefined, parseInt(parts[3])),
	                    this.convertDebuggerLineToClient(parseInt(parts[5])),
	                    1
	                )
	            }
	        }),
	        totalFrames: stk.length
	    }
	    this.sendResponse(response)
	}

	protected async sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments) {
	    const ret = await this.sendRequestToDebugger('GETSOURCE', args.source.sourceReference.toString())

	    response.body = { content: ret }

	    this.sendResponse(response)
	}

	protected async scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments) {

	    const resp = await this.sendRequestToDebugger('GETSCOPE', args.frameId.toString())

	    const parts = resp.split(';')

	    const scope_name = parts[0]
	    const variablereference = parseInt(parts[1])

	    if (parts.length === 2) {
	        response.body = {
	            scopes: [
	                new Scope(scope_name, variablereference, false),
	                // new Scope("Global", this._variableHandles.create("global"), true)
	            ]
	        }
	    }
	    else {
	        const line = parseInt(parts[2])
	        const endLine = parseInt(parts[3])
	        const filename = parts[4]

	        response.body = {
	            scopes: [
	                {
	                    name: scope_name,
	                    variablesReference: variablereference,
	                    expensive: false,
	                    line: line,
	                    endLine: endLine,
	                    source: {
	                        name: basename(filename),
	                        path: this.convertDebuggerPathToClient(filename)

	                    }
	                }

	                // new Scope("Global", this._variableHandles.create("global"), true)
	            ]
	        }

	    }
	    this.sendResponse(response)
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request) {

	    const variables: DebugProtocol.Variable[] = []

	    const ret = await this.sendRequestToDebugger('GETVARIABLES', `${args.variablesReference.toString()};${args.filter ? args.filter : ''};${args.start ? args.start : ''};${args.count ? args.count : ''}`)

	    const vars = ret === '' ? [] : ret.split('\n')

	    for (const v of vars) {
	        const parts = v.split(';')

	        const varref = parseInt(parts[0])
	        const varname = parts[1]
	        const vartype = parts[2]
	        const named_count = parseInt(parts[3])
	        const indexed_count = parseInt(parts[4])
	        const varvalue = Buffer.from(parts[5], 'base64').toString()

	        variables.push({
	            name: varname,
	            type: vartype,
	            value: varvalue,
	            namedVariables: varref > 0 ? named_count : undefined,
	            indexedVariables: varref > 0 ? indexed_count : undefined,
	            variablesReference: varref
	        })
	    }

	    response.body = {
	        variables: variables
	    }
	    this.sendResponse(response)
	}

	protected async setVariableRequest(response: DebugProtocol.SetVariableResponse, args: DebugProtocol.SetVariableArguments) {
	    const encoded_value = Buffer.from(args.value).toString('base64')
	    const encoded_name = Buffer.from(args.name).toString('base64')

	    const resp = await this.sendRequestToDebugger('SETVARIABLE', `${args.variablesReference};${encoded_name};${encoded_value}`)

	    const parts = resp.split(';')

	    const status = parts[0]

	    if (status === 'FAILED') {

	        const errorMsg = Buffer.from(parts[1], 'base64').toString()

	        response.success = false
	        response.message = errorMsg
	    }
	    else if (status === 'SUCCESS') {
	        const varref = parseInt(parts[1])
	        const vartype = parts[3]
	        const named_count = parseInt(parts[4])
	        const indexed_count = parseInt(parts[5])
	        const varvalue = Buffer.from(parts[6], 'base64').toString()

	        response.body = {
	            value: varvalue,
	            type: vartype,
	            variablesReference: varref,
	            namedVariables: named_count,
	            indexedVariables: indexed_count
	        }
	    }

	    this.sendResponse(response)
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
	    this.sendNotificationToDebugger('CONTINUE')
	    this.sendResponse(response)
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
	    this.sendNotificationToDebugger('NEXT')
	    this.sendResponse(response)
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
	    this.sendNotificationToDebugger('STEPIN')
	    this.sendResponse(response)
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
	    this.sendNotificationToDebugger('STEPOUT')
	    this.sendResponse(response)
	}

	protected restartFrameRequest(response: DebugProtocol.RestartFrameResponse, args: DebugProtocol.RestartFrameArguments) {
	    this.sendNotificationToDebugger('RESTARTFRAME', args.frameId.toString())

	    this.sendResponse(response)
	}

	protected terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments): void {
	    if (this._launchedWithoutDebug) {
	        // TODO this._debuggeeWrapperSocket.write('TERMINATE\n')
	        this.sendEvent(new TerminatedEvent())
	    }
	    else {
	        this.sendNotificationToDebugger('TERMINATE')
	    }
	    this.sendResponse(response)
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
	    if (this._launchMode) {
	        if (!this._no_need_for_force_kill) {
	            // TODO this._debuggeeWrapperSocket.write('TERMINATE\n')
	        }
	    }
	    else {
	        this.sendNotificationToDebugger('DISCONNECT')
	    }

	    this.sendResponse(response)
	}

	protected async evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments) {

	    const resp = await this.sendRequestToDebugger('EVALUATE', `${args.frameId}:${args.expression}`)

	    response.body = {
	        result: resp,
	        variablesReference: 0
	    }
	    this.sendResponse(response)
	}

	protected dataBreakpointInfoRequest(response: DebugProtocol.DataBreakpointInfoResponse, args: DebugProtocol.DataBreakpointInfoArguments): void {

	    response.body = {
	        dataId: null,
	        description: 'cannot break on data access',
	        accessTypes: undefined,
	        canPersist: false
	    }

	    if (args.variablesReference && args.name) {
	        // const id = this._variableHandles.get(args.variablesReference);
	        // TODO FIX THIS
	        const id = ''
	        if (id.startsWith('global_')) {
	            response.body.dataId = args.name
	            response.body.description = args.name
	            response.body.accessTypes = ['read']
	            response.body.canPersist = true
	        }
	    }

	    this.sendResponse(response)
	}

	protected setDataBreakpointsRequest(response: DebugProtocol.SetDataBreakpointsResponse, args: DebugProtocol.SetDataBreakpointsArguments): void {

	    // // clear all data breakpoints
	    // this._runtime.clearAllDataBreakpoints();

	    // response.body = {
	    // 	breakpoints: []
	    // };

	    // for (let dbp of args.breakpoints) {
	    // 	// assume that id is the "address" to break on
	    // 	const ok = this._runtime.setDataBreakpoint(dbp.dataId);
	    // 	response.body.breakpoints.push({
	    // 		verified: ok
	    // 	});
	    // }

	    this.sendResponse(response)
	}

	protected async exceptionInfoRequest(response: DebugProtocol.ExceptionInfoResponse, args: DebugProtocol.ExceptionInfoArguments) {
	    const resp = await this.sendRequestToDebugger('GETEXCEPTIONINFO')

	    const decoded_parts = resp.split(';').map(i => Buffer.from(i, 'base64').toString())

	    const exception_id = decoded_parts[0]
	    const exception_description = decoded_parts[1]
	    const excpetion_stacktrace = decoded_parts[2]

	    response.body = {
	        exceptionId: exception_id,
	        description: exception_description,
	        breakMode: 'userUnhandled',
	        details: {
	            stackTrace: excpetion_stacktrace
	        }
	    }

	    // throw new Error("foo")
	    this.sendResponse(response)
	}

	protected completionsRequest(response: DebugProtocol.CompletionsResponse, args: DebugProtocol.CompletionsArguments): void {

	    response.body = {
	        targets: [
	            {
	                label: 'item 10',
	                sortText: '10'
	            },
	            {
	                label: 'item 1',
	                sortText: '01'
	            },
	            {
	                label: 'item 2',
	                sortText: '02'
	            }
	        ]
	    }
	    this.sendResponse(response)
	}

	protected cancelRequest(response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments) {
	    if (args.requestId) {
	        this._cancelationTokens.set(args.requestId, true)
	    }
	}

	//---- helpers

	private createSource(filePath: string): Source {
	    return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'julia-adapter-data')
	}
}
