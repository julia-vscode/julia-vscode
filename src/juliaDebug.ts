import {
	Logger, logger,
	LoggingDebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { basename, join } from 'path';
import { MockRuntime, MockBreakpoint } from './mockRuntime';
import { pathToFileURL } from 'url';
import { homedir } from 'os';
import { downloadAndUnzipVSCode } from 'vscode-test';
import { window, ExtensionContext, Terminal } from 'vscode';
import { Disposable } from 'vscode-jsonrpc';
import * as net from 'net';
const { Subject } = require('await-notify');
import * as readline from 'readline';
import { generatePipeName } from './utils';
import { uuid } from 'uuidv4';
import { sendMessage } from './repl';
import * as vscode from 'vscode';
import { getVSCodeDownloadUrl } from 'vscode-test/out/util';

function timeout(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * This interface describes the mock-debug specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the mock-debug extension.
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
}

export class JuliaDebugSession extends LoggingDebugSession {

	// we don't support multiple threads, so we can use a hardcoded ID for the default thread
	private static THREAD_ID = 1;

	// a Mock runtime (or debugger)
	private _runtime: MockRuntime;

	private _variableHandles = new Handles<{scope: string, frameId: number}>();

	private _configurationDone = new Subject();

	private _cancelationTokens = new Map<number, boolean>();
	private _isLongrunning = new Map<number, boolean>();

	private _juliaPath: string;
	private _context: ExtensionContext;

	private _debuggeeTerminal: Terminal;
	private _debuggeeSocket: net.Socket;
	private _debuggeeWrapperSocket: net.Socket;

	private _launchMode: boolean;
	private _launchedWithoutDebug: boolean;

	private _nextRequestId: number = 0;

	private _requestResponses: Map<number, {requestArrived: any, data: string}> = new Map<number, {requestArrived: any, data: string}>();

	private _no_need_for_force_kill: boolean = false;

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor(context: ExtensionContext, juliaPath: string) {
		super("mock-debug.txt");
		this._context = context;
		this._juliaPath = juliaPath;

		// this debugger uses zero-based lines and columns
		this.setDebuggerLinesStartAt1(true);
		this.setDebuggerColumnsStartAt1(true);

		this._runtime = new MockRuntime();

		// setup event handlers
		this._runtime.on('stopOnEntry', () => {
			this.sendEvent(new StoppedEvent('entry', JuliaDebugSession.THREAD_ID));
		});
		this._runtime.on('stopOnStep', () => {
			this.sendEvent(new StoppedEvent('step', JuliaDebugSession.THREAD_ID));
		});
		this._runtime.on('stopOnBreakpoint', () => {
			this.sendEvent(new StoppedEvent('breakpoint', JuliaDebugSession.THREAD_ID));
		});
		this._runtime.on('stopOnDataBreakpoint', () => {
			this.sendEvent(new StoppedEvent('data breakpoint', JuliaDebugSession.THREAD_ID));
		});
		this._runtime.on('stopOnException', () => {
			this.sendEvent(new StoppedEvent('exception', JuliaDebugSession.THREAD_ID));
		});
		this._runtime.on('breakpointValidated', (bp: MockBreakpoint) => {
			this.sendEvent(new BreakpointEvent('changed', <DebugProtocol.Breakpoint>{ verified: bp.verified, id: bp.id }));
		});
		this._runtime.on('output', (text, filePath, line, column) => {
			const e: DebugProtocol.OutputEvent = new OutputEvent(`${text}\n`);
			e.body.source = this.createSource(filePath);
			e.body.line = this.convertDebuggerLineToClient(line);
			e.body.column = this.convertDebuggerColumnToClient(column);
			this.sendEvent(e);
		});
		this._runtime.on('end', () => {
			this.sendEvent(new TerminatedEvent());
		});
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected async initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): Promise<void> {

		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// the adapter implements the configurationDoneRequest.
		response.body.supportsConfigurationDoneRequest = true;

		response.body.supportsFunctionBreakpoints = true;

		// make VS Code to use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = false;

		// make VS Code to show a 'step back' button
		response.body.supportsStepBack = false;

		// make VS Code to support data breakpoints
		response.body.supportsDataBreakpoints = false;

		// make VS Code to support completion in REPL
		response.body.supportsCompletionsRequest = false;
		// response.body.completionTriggerCharacters = [".", "["];

		// make VS Code to send cancelRequests
		response.body.supportsCancelRequest = false;

		response.body.supportsTerminateRequest = true;

		// make VS Code send the breakpointLocations request
		response.body.supportsBreakpointLocationsRequest = true;

		response.body.exceptionBreakpointFilters = [{ filter: 'error', label: 'Break any time an uncaught exception is thrown', default: true }, { filter: 'throw', label: 'Break any time a throw is executed', default: false }];

		this.sendResponse(response);
	}

	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);

		// notify the launchRequest that configuration has finished
		this._configurationDone.notify();
	}

	protected sendNotificationToDebugger(cmd: string, body: string='') {
		let encoded_body = Buffer.from(body).toString('base64');

		this._debuggeeSocket.write(`notification:${cmd}:${encoded_body}\n`)
	}

	protected async sendRequestToDebugger(cmd: string, body: string=''): Promise<string> {
		const requestId = this._nextRequestId;
		this._nextRequestId += 1;

		const responseArrived = new Subject();

		this._requestResponses[requestId] = {requestArrived: responseArrived, data: ''};

		let encoded_body = Buffer.from(body).toString('base64');

		this._debuggeeSocket.write(`${requestId}:${cmd}:${encoded_body}\n`)

		await responseArrived.wait();

		const response = this._requestResponses[requestId].data;

		this._requestResponses.delete(requestId);

		return response
	}

	protected processMsgFromDebugger(line: string) {
		const parts = line.split(':');
		const msg_cmd = parts[0];
		const msg_id = parts[1];
		const msg_body = Buffer.from(parts[2], 'base64').toString();

		if (msg_cmd == 'STOPPEDBP') {
			this.sendEvent(new StoppedEvent('breakpoint', JuliaDebugSession.THREAD_ID));
		}
		else if (msg_cmd == 'STOPPEDSTEP') {
			this.sendEvent(new StoppedEvent('step', JuliaDebugSession.THREAD_ID));
		}
		else if (msg_cmd == 'STOPPEDEXCEPTION') {
			this.sendEvent(new StoppedEvent('exception', JuliaDebugSession.THREAD_ID));
		}
		else if (msg_cmd == 'STOPPEDFUNCBP') {
			this.sendEvent(new StoppedEvent('function breakpoint', JuliaDebugSession.THREAD_ID));
		}
		else if (msg_cmd == 'STOPPEDENTRY') {
			this.sendEvent(new StoppedEvent('entry', JuliaDebugSession.THREAD_ID));
		}
		else if (msg_cmd == 'FINISHED') {
			this._no_need_for_force_kill = true;
			this.sendEvent(new TerminatedEvent())
		}
		else if (msg_cmd == 'RESPONSE') {
			this._requestResponses[parseInt(msg_id)].data = msg_body;
			this._requestResponses[parseInt(msg_id)].requestArrived.notify();
		}
		else {
			throw "Unknown message received";			
		}
	}

	protected async attachRequest(response: DebugProtocol.AttachResponse, args: DebugProtocol.AttachRequestArguments) {
		this._launchMode = false;
		const pn = generatePipeName(uuid(), 'vscode-language-julia-debugger');

		let connectedPromise = new Subject();
		let serverListeningPromise = new Subject();

		let server = net.createServer(socket => {
			this._debuggeeSocket = socket;
			const rl = readline.createInterface(socket);

			rl.on('line', this.processMsgFromDebugger.bind(this));

			connectedPromise.notify();
		});

		server.listen(pn, () => {
			serverListeningPromise.notify();
		});

		await serverListeningPromise.wait();

		sendMessage('repl/startdebugger', pn);

		await connectedPromise.wait();

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());

		// wait until configuration has finished (and configurationDoneRequest has been called)
		// await this._configurationDone.wait(1000);
		await this._configurationDone.wait();


		let code_to_run = args['code']

		this.sendNotificationToDebugger('EXEC', code_to_run);

		this.sendResponse(response);
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LaunchRequestArguments) {
		this._launchMode = true;
		// make sure to 'Stop' the buffered logging if 'trace' is not set
		logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);

		let connectedPromise = new Subject();
		let serverListeningPromise = new Subject();
		let serverForWrapperPromise = new Subject();

		const pn = generatePipeName(uuid(), 'vscode-language-julia-debugger');
		const pnForWrapper = generatePipeName(uuid(), 'vscode-language-julia-debugger-wrapper');

		let server = net.createServer(socket => {
			this._debuggeeSocket = socket;
			const rl = readline.createInterface(socket);

			rl.on('line', this.processMsgFromDebugger.bind(this));

			connectedPromise.notify();
		});

		let serverForWrapper = net.createServer(socket => {
			this._debuggeeWrapperSocket = socket;
		});

		serverForWrapper.listen(pnForWrapper, () => {
			serverForWrapperPromise.notify();
		});

		await serverForWrapperPromise.wait();

		server.listen(pn, () => {
			serverListeningPromise.notify();
		});

		await serverListeningPromise.wait();

		this._debuggeeTerminal = window.createTerminal({
			name: "Julia Debugger",
			shellPath: this._juliaPath,
			shellArgs: [
				'--color=yes',
				'--startup-file=no',
				'--history-file=no',
				join(this._context.extensionPath, 'scripts', 'debugger', 'launch_wrapper.jl'),
				pn,
				pnForWrapper,
				args.cwd,
				args.juliaEnv
			]
		});
		this._debuggeeTerminal.show(false);
		let asdf: Array<Disposable> = [];
		window.onDidCloseTerminal((terminal) => {
			if (terminal == this._debuggeeTerminal) {
				this.sendEvent(new TerminatedEvent());
				asdf[0].dispose();
			}
		}, this, asdf);

		await connectedPromise.wait();

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());

		// wait until configuration has finished (and configurationDoneRequest has been called)
		// await this._configurationDone.wait(1000);
		await this._configurationDone.wait();

		this._launchedWithoutDebug = args.noDebug;

		if (args.noDebug) {
			this.sendNotificationToDebugger('RUN', args.program);
		}
		else {
			this.sendNotificationToDebugger('DEBUG', `${args.stopOnEntry ? 'stopOnEntry=true' : 'stopOnEntry=false'};${args.program}`);
		}

		this.sendResponse(response);
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {

		const path = <string>args.source.path;
		const clientLines = args.breakpoints || [];

		let msgForClient = path;

		for (let i of args.breakpoints) {
			msgForClient = msgForClient + `;${i.line}`
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
		};
		this.sendResponse(response);
	}

	protected setFunctionBreakPointsRequest(response: DebugProtocol.SetFunctionBreakpointsResponse, args: DebugProtocol.SetFunctionBreakpointsArguments): void {
		let msgForClient = args.breakpoints.map(i => i.name).join(';');

		this.sendNotificationToDebugger('SETFUNCBREAKPOINTS', msgForClient)

		response.body = {
			breakpoints: args.breakpoints.map(i => new Breakpoint(true))
		}

		this.sendResponse(response);
	}

	protected setExceptionBreakPointsRequest(response: DebugProtocol.SetExceptionBreakpointsResponse, args: DebugProtocol.SetExceptionBreakpointsArguments): void {
		this.sendNotificationToDebugger('SETEXCEPTIONBREAKPOINTS', args.filters.join(';'))

		this.sendResponse(response);
	}

	protected breakpointLocationsRequest(response: DebugProtocol.BreakpointLocationsResponse, args: DebugProtocol.BreakpointLocationsArguments, request?: DebugProtocol.Request): void {

		if (args.source.path) {
			const bps = this._runtime.getBreakpoints(args.source.path, this.convertClientLineToDebugger(args.line));
			response.body = {
				breakpoints: bps.map(col => {
					return {
						line: args.line,
						column: this.convertDebuggerColumnToClient(col)
					}
				})
			};
		} else {
			response.body = {
				breakpoints: []
			};
		}
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {

		// runtime supports no threads so just return a default thread.
		response.body = {
			threads: [
				new Thread(JuliaDebugSession.THREAD_ID, "thread 1")
			]
		};
		this.sendResponse(response);
	}

	protected async stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments) {
		const resp = await this.sendRequestToDebugger('GETSTACKTRACE');
		const stk = resp.split('\n');



		// const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
		// const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
		// const endFrame = startFrame + maxLevels;

		// const stk = this._runtime.stack(startFrame, endFrame);

		response.body = {
			stackFrames: stk.map(f => {
				const parts = f.split(';');

				if (parts[2]=='path') {
					// TODO Figure out how we can get a proper stackframe ID
					// TODO Make sure ; is a good separator here...
					return new StackFrame(parseInt(parts[0]), parts[1], this.createSource(parts[3]), this.convertDebuggerLineToClient(parseInt(parts[4])))
				}
				else {
					return new StackFrame(
						parseInt(parts[0]),
						parts[1],
						new Source(parts[5],undefined,parseInt(parts[3])),
						this.convertDebuggerLineToClient(parseInt(parts[4]))
					)
				}
			}),
			totalFrames: stk.length
		};
		this.sendResponse(response);
	}

	protected async sourceRequest(response: DebugProtocol.SourceResponse, args: DebugProtocol.SourceArguments) {
		const ret = await this.sendRequestToDebugger('GETSOURCE', args.sourceReference.toString());	

		response.body = {content: ret};

		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {

		response.body = {
			scopes: [
				new Scope("Local", this._variableHandles.create({scope: "local", frameId: args.frameId}), false),
				// new Scope("Global", this._variableHandles.create("global"), true)
			]
		};
		this.sendResponse(response);
	}

	protected async variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments, request?: DebugProtocol.Request) {

		const variables: DebugProtocol.Variable[] = [];

		const details = this._variableHandles.get(args.variablesReference);

		const ret = await this.sendRequestToDebugger('GETVARIABLES', details.frameId.toString());

		const vars = ret=='' ? [] : ret.split('\n');

		for (let v of vars) {
			let parts = v.split(';')

			variables.push({
				name: parts[0],
				type: parts[1],
				value: parts[2],
				variablesReference: 0
			});
		}

		response.body = {
			variables: variables
		};
		this.sendResponse(response);
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this.sendNotificationToDebugger('CONTINUE');
		this.sendResponse(response);
	}

	protected reverseContinueRequest(response: DebugProtocol.ReverseContinueResponse, args: DebugProtocol.ReverseContinueArguments): void {
		this._runtime.continue(true);
		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this.sendNotificationToDebugger('NEXT');
		this.sendResponse(response);
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		this.sendNotificationToDebugger('STEPIN');
		this.sendResponse(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		this.sendNotificationToDebugger('STEPOUT');
		this.sendResponse(response);
	}

	protected terminateRequest(response: DebugProtocol.TerminateResponse, args: DebugProtocol.TerminateArguments): void {
		if (this._launchedWithoutDebug) {
			this._debuggeeWrapperSocket.write('TERMINATE\n');
			this.sendEvent(new TerminatedEvent());
		}
		else {
			this.sendNotificationToDebugger('TERMINATE');
		}
		this.sendResponse(response);
	}

	protected disconnectRequest(response: DebugProtocol.DisconnectResponse, args: DebugProtocol.DisconnectArguments): void {
		if (this._launchMode && !this._no_need_for_force_kill) {
			this._debuggeeWrapperSocket.write('TERMINATE\n');
		}
		else {
			this.sendNotificationToDebugger('DISCONNECT');
		}

		this.sendResponse(response);
	}

	protected stepBackRequest(response: DebugProtocol.StepBackResponse, args: DebugProtocol.StepBackArguments): void {
		this._runtime.step(true);
		this.sendResponse(response);
	}

	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {

		let reply: string | undefined = undefined;

		if (args.context === 'repl') {
			// 'evaluate' supports to create and delete breakpoints from the 'repl':
			const matches = /new +([0-9]+)/.exec(args.expression);
			if (matches && matches.length === 2) {
				const mbp = this._runtime.setBreakPoint(this._runtime.sourceFile, this.convertClientLineToDebugger(parseInt(matches[1])));
				const bp = <DebugProtocol.Breakpoint>new Breakpoint(mbp.verified, this.convertDebuggerLineToClient(mbp.line), undefined, this.createSource(this._runtime.sourceFile));
				bp.id = mbp.id;
				this.sendEvent(new BreakpointEvent('new', bp));
				reply = `breakpoint created`;
			} else {
				const matches = /del +([0-9]+)/.exec(args.expression);
				if (matches && matches.length === 2) {
					const mbp = this._runtime.clearBreakPoint(this._runtime.sourceFile, this.convertClientLineToDebugger(parseInt(matches[1])));
					if (mbp) {
						const bp = <DebugProtocol.Breakpoint>new Breakpoint(false);
						bp.id = mbp.id;
						this.sendEvent(new BreakpointEvent('removed', bp));
						reply = `breakpoint deleted`;
					}
				}
			}
		}

		response.body = {
			result: reply ? reply : `evaluate(context: '${args.context}', '${args.expression}')`,
			variablesReference: 0
		};
		this.sendResponse(response);
	}

	protected dataBreakpointInfoRequest(response: DebugProtocol.DataBreakpointInfoResponse, args: DebugProtocol.DataBreakpointInfoArguments): void {

		response.body = {
			dataId: null,
			description: "cannot break on data access",
			accessTypes: undefined,
			canPersist: false
		};

		if (args.variablesReference && args.name) {
			// const id = this._variableHandles.get(args.variablesReference);
			// TODO FIX THIS
			const id = '';
			if (id.startsWith("global_")) {
				response.body.dataId = args.name;
				response.body.description = args.name;
				response.body.accessTypes = ["read"];
				response.body.canPersist = true;
			}
		}

		this.sendResponse(response);
	}

	protected setDataBreakpointsRequest(response: DebugProtocol.SetDataBreakpointsResponse, args: DebugProtocol.SetDataBreakpointsArguments): void {

		// clear all data breakpoints
		this._runtime.clearAllDataBreakpoints();

		response.body = {
			breakpoints: []
		};

		for (let dbp of args.breakpoints) {
			// assume that id is the "address" to break on
			const ok = this._runtime.setDataBreakpoint(dbp.dataId);
			response.body.breakpoints.push({
				verified: ok
			});
		}

		this.sendResponse(response);
	}

	protected completionsRequest(response: DebugProtocol.CompletionsResponse, args: DebugProtocol.CompletionsArguments): void {

		response.body = {
			targets: [
				{
					label: "item 10",
					sortText: "10"
				},
				{
					label: "item 1",
					sortText: "01"
				},
				{
					label: "item 2",
					sortText: "02"
				}
			]
		};
		this.sendResponse(response);
	}

	protected cancelRequest(response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments) {
		if (args.requestId) {
			this._cancelationTokens.set(args.requestId, true);
		}
	}

	//---- helpers

	private createSource(filePath: string): Source {
		return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'mock-adapter-data');
	}
}
