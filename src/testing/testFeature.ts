import { ChildProcessWithoutNullStreams, spawn } from 'child_process'
import * as semver from 'semver'
import { v4 as uuidv4 } from 'uuid'
import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc/node'
import { JuliaExecutable, ExecutableFeature, JuliaNotFoundError } from '../executables'
import * as path from 'path'
import { getCrashReportingPipename, handleNewCrashReportFromException } from '../telemetry'
import { TestControllerNode, TestProcessNode, WorkspaceFeature } from '../interactive/workspace'
import { cpus } from 'os'
import * as vslc from 'vscode-languageclient/node'
import { LanguageClientFeature } from '../languageClient'
import {
    notficiationTypeTestItemErrored,
    notficiationTypeTestItemFailed,
    notficiationTypeTestItemPassed,
    notficiationTypeTestItemSkipped,
    notficiationTypeTestItemStarted,
    notificationTypeAppendOutput,
    notificationTypeLaunchDebugger,
    notificationTypeTestProcessCreated,
    notificationTypeTestProcessOutput,
    notificationTypeTestProcessStatusChanged,
    notificationTypeTestProcessTerminated,
    PerfStats,
    requestTypeCreateTestRun,
    requestTypeTerminateTestProcess,
} from './testControllerProtocol'
import * as tlsp from './testLSProtocol'
import { DebugConfigTreeProvider } from '../debugger/debugConfig'
import { getCustomEnvironmentVariables, inferJuliaNumThreads, onEvent, registerCommand } from '../utils'

enum TestRunMode {
    Normal,
    Debug,
    Coverage,
}

function modeAsString(mode: TestRunMode) {
    if (mode === TestRunMode.Normal) {
        return 'Normal'
    } else if (mode === TestRunMode.Debug) {
        return 'Debug'
    } else if (mode === TestRunMode.Coverage) {
        return 'Coverage'
    } else {
        throw new Error(`Invalid mode value.`)
    }
}

interface OurFileCoverage extends vscode.FileCoverage {
    detailedCoverage: vscode.StatementCoverage[]
}

export function formatBytes(bytes: number) {
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
        value = value / 1024
        unit += 1
    }
    return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`
}

export function formatMillis(millis: number) {
    if (millis < 1) {
        return `${Math.round(millis * 1000)} µs`
    } else if (millis < 1000) {
        return `${millis.toFixed(millis < 10 ? 1 : 0)} ms`
    } else {
        return `${(millis / 1000).toFixed(2)} s`
    }
}

/**
 * A one line summary of the performance statistics a test process measured for one test item,
 * or `undefined` when it reported none of them. Every field is optional on the wire: the
 * compile timings in particular are unavailable on some of the Julia versions a test process
 * can run on.
 */
export function formatPerfStats(perf: PerfStats) {
    const parts: string[] = []

    if (perf.elapsed !== undefined && perf.elapsed !== null) {
        parts.push(formatMillis(perf.elapsed))
    }
    if (perf.bytes !== undefined && perf.bytes !== null) {
        parts.push(formatBytes(perf.bytes))
    }
    if (perf.allocs !== undefined && perf.allocs !== null) {
        parts.push(`${perf.allocs.toLocaleString('en-US')} allocs`)
    }
    if (perf.gctime !== undefined && perf.gctime !== null) {
        parts.push(`gc ${formatMillis(perf.gctime)}`)
    }
    if (perf.compileTime !== undefined && perf.compileTime !== null) {
        parts.push(`compile ${formatMillis(perf.compileTime)}`)
    }
    if (perf.recompileTime !== undefined && perf.recompileTime !== null) {
        parts.push(`recompile ${formatMillis(perf.recompileTime)}`)
    }

    return parts.length > 0 ? `⏱ ${parts.join(' · ')}` : undefined
}

/**
 * The key a test item is tracked under for the duration of a run.
 *
 * A test item id is unique within its package, so two checkouts of the same package — two
 * worktrees, or a vendored copy beside a dev checkout — mint the same id. The environment id
 * is what separates them, and it is how the controller keys its own per-run state.
 */
export function testItemKey(testEnvId: string, testItemId: string) {
    return `${testEnvId} ${testItemId}`
}

export class JuliaTestProcess {
    private status: string

    private _onStatusChanged = new vscode.EventEmitter<void>()
    public onStatusChanged = this._onStatusChanged.event

    constructor(
        public id: string,
        public packageName: string,
        public packageUri: string | undefined,
        public projectUri: string | undefined,
        public coverage: boolean | undefined,
        public env: { [key: string]: string | null },
        public juliaChannelName: string | undefined,
        private controller: JuliaTestController
    ) {
        this.status = 'Created'
    }

    setStatus(status: string) {
        this.status = status
        this._onStatusChanged.fire()
    }

    public getStatus() {
        return this.status
    }

    kill() {
        this.controller.killTestProcess(this.id)
    }
}

export class JuliaTestController {
    private _onKilled = new vscode.EventEmitter<void>()
    public onKilled = this._onKilled.event

    kill() {
        this.process.kill()
    }

    private connection: rpc.MessageConnection
    private process: ChildProcessWithoutNullStreams
    private testRuns = new Map<string, { testRun: vscode.TestRun; testItems: Map<string, vscode.TestItem> }>()
    private testProcesses = new Map<string, JuliaTestProcess>()
    private currentRunExecutable: JuliaExecutable | undefined

    constructor(
        private testFeature: TestFeature,
        private executableFeature: ExecutableFeature,
        private workspaceFeature: WorkspaceFeature,
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel,
        private compiledProvider: DebugConfigTreeProvider
    ) {}

    public ready() {
        return this.process
    }

    killTestProcess(id: string) {
        this.connection.sendRequest(requestTypeTerminateTestProcess, { testProcessId: id })
    }

    /**
     * The run and test item a notification refers to, or `undefined` if either has gone away.
     *
     * Both lookups can miss: a notification can arrive after the run ended, and an id the
     * extension never sent resolves to no item. Passing `undefined` on to `vscode.TestRun`
     * throws inside the JSON-RPC handler, which takes the connection down with it, so every
     * handler goes through here and returns early instead.
     */
    private resolve(i: { testRunId: string; testItemId?: string; testEnvId: string }) {
        const testRun = this.testRuns.get(i.testRunId)

        if (!testRun) {
            return undefined
        }

        const testItem =
            i.testItemId === undefined || i.testItemId === null
                ? undefined
                : testRun.testItems.get(testItemKey(i.testEnvId, i.testItemId))

        // A named item that does not resolve means the run and the controller disagree about
        // the (environment, item) pairs in flight. The visible symptom is an item stuck at
        // "enqueued" with nothing else to go on, so say so here rather than dropping silently.
        if (i.testItemId && !testItem) {
            this.outputChannel.appendLine(
                `No test item for id '${i.testItemId}' in environment '${i.testEnvId}' of test run '${i.testRunId}'.`
            )
        }

        return { testRun: testRun.testRun, testItem }
    }

    /**
     * The VS Code test API has nowhere to put performance statistics, so they go into the
     * test run output of the item they belong to.
     */
    private appendPerf(testRun: vscode.TestRun, testItem: vscode.TestItem, perf: PerfStats | undefined) {
        if (!perf) {
            return
        }

        const summary = formatPerfStats(perf)

        if (summary) {
            testRun.appendOutput(`${summary}\r\n`, undefined, testItem)
        }
    }

    public async start() {
        this.workspaceFeature.addTestController(this)

        let juliaExecutable: JuliaExecutable | null

        try {
            juliaExecutable = await this.executableFeature.getExecutable()
        } catch (err) {
            if (err instanceof JuliaNotFoundError) {
                return true
            }
            throw err
        }

        const jlArgs = ['--startup-file=no', '--history-file=no', '--depwarn=no']

        const debugEnvVar = process.env.DEBUG_MODE
            ? {
                  JULIA_DEBUG: 'TestItemControllers',
              }
            : {}

        this.process = spawn(
            juliaExecutable.command,
            [
                ...juliaExecutable.args,
                ...jlArgs,
                path.join(this.context.extensionPath, 'scripts', 'apps', 'testitemcontroller_main.jl'),
                getCrashReportingPipename(),
            ],
            {
                detached: false,
                env: { ...process.env, ...getCustomEnvironmentVariables(), ...debugEnvVar },
            }
        )

        this.connection = rpc.createMessageConnection(this.process.stdout, this.process.stdin)
        this.connection.onNotification(notficiationTypeTestItemStarted, (i) => {
            const resolved = this.resolve(i)
            if (!resolved?.testItem) {
                return
            }
            const { testRun, testItem } = resolved

            testRun.started(testItem)
        })
        this.connection.onNotification(notficiationTypeTestItemErrored, (i) => {
            const resolved = this.resolve(i)
            if (!resolved?.testItem) {
                return
            }
            const { testRun, testItem } = resolved

            testRun.errored(
                testItem,
                i.messages.map((i) => {
                    const msg = new vscode.TestMessage(i.message)
                    if (i.uri && i.line && i.column) {
                        msg.location = new vscode.Location(
                            vscode.Uri.parse(i.uri),
                            new vscode.Position(i.line - 1, i.column - 1)
                        )
                    }
                    if (i.stackTrace) {
                        msg.stackTrace = i.stackTrace.map((s) => {
                            return new vscode.TestMessageStackFrame(
                                s.label,
                                s.uri ? vscode.Uri.parse(s.uri) : undefined,
                                s.line && s.column ? new vscode.Position(s.line - 1, s.column - 1) : undefined
                            )
                        })
                    }

                    return msg
                }),
                i.duration
            )

            this.appendPerf(testRun, testItem, i.perf)
        })
        this.connection.onNotification(notficiationTypeTestItemFailed, (i) => {
            const resolved = this.resolve(i)
            if (!resolved?.testItem) {
                return
            }
            const { testRun, testItem } = resolved

            const messages = i.messages.map((j) => {
                const msg = new vscode.TestMessage(j.message)

                if (j.actualOutput !== null && j.expectedOutput !== null) {
                    msg.actualOutput = j.actualOutput
                    msg.expectedOutput = j.expectedOutput
                }

                if (j.uri !== null && j.line !== null && j.column !== null) {
                    msg.location = new vscode.Location(
                        vscode.Uri.parse(j.uri),
                        new vscode.Position(j.line - 1, j.column - 1)
                    )
                }

                if (j.stackTrace) {
                    msg.stackTrace = j.stackTrace.map((s) => {
                        return new vscode.TestMessageStackFrame(
                            s.label,
                            s.uri ? vscode.Uri.parse(s.uri) : undefined,
                            s.line && s.column ? new vscode.Position(s.line - 1, s.column - 1) : undefined
                        )
                    })
                }
                return msg
            })

            testRun.failed(testItem, messages, i.duration)

            this.appendPerf(testRun, testItem, i.perf)
        })
        this.connection.onNotification(notficiationTypeTestItemPassed, (i) => {
            const resolved = this.resolve(i)
            if (!resolved?.testItem) {
                return
            }
            const { testRun, testItem } = resolved

            testRun.passed(testItem, i.duration)

            this.appendPerf(testRun, testItem, i.perf)
        })
        this.connection.onNotification(notficiationTypeTestItemSkipped, (i) => {
            const resolved = this.resolve(i)
            if (!resolved?.testItem) {
                return
            }
            const { testRun, testItem } = resolved

            testRun.skipped(testItem)

            // `skipped` takes no message, so the `skip` expression that caused this only has
            // the test run output to show up in. A literal `skip=true` arrives as the source
            // text `true`, which says nothing the skipped status does not already say.
            if (i.reason && i.reason !== 'true') {
                testRun.appendOutput(`Skipped: ${i.reason}\r\n`, undefined, testItem)
            }
        })
        this.connection.onNotification(notificationTypeAppendOutput, (i) => {
            // Unlike the result notifications, output with no test item is expected: it is the
            // process-level output, and it belongs on the run itself.
            const resolved = this.resolve(i)
            if (!resolved) {
                return
            }

            resolved.testRun.appendOutput(i.output, undefined, resolved.testItem)
        })
        this.connection.onNotification(notificationTypeTestProcessCreated, (i) => {
            const channelName = this.currentRunExecutable?.juliaupChannel?.name
            const tp = new JuliaTestProcess(
                i.id,
                i.packageName,
                i.packageUri,
                i.projectUri,
                i.coverage,
                i.env,
                channelName,
                this
            )
            this.testProcesses.set(i.id, tp)
            this.workspaceFeature.addTestProcess(tp)
        })
        this.connection.onNotification(notificationTypeTestProcessStatusChanged, (i) => {
            const tp = this.testProcesses.get(i.id)
            if (!tp) {
                return
            }

            tp.setStatus(i.status)
        })
        this.connection.onNotification(notificationTypeTestProcessOutput, (i) => {
            if (!this.testFeature.juliaTestProcessOutputChannels.has(i.id)) {
                const newOutputChannel = vscode.window.createOutputChannel(`Julia Test Process ${i.id}`)
                this.testFeature.juliaTestProcessOutputChannels.set(i.id, newOutputChannel)
            }

            const outputChannel = this.testFeature.juliaTestProcessOutputChannels.get(i.id)
            outputChannel.append(i.output)
        })
        this.connection.onNotification(notificationTypeTestProcessTerminated, (i) => {
            // The output channel is disposed either way — the process is gone regardless of
            // whether we still had it tracked.
            const tp = this.testProcesses.get(i.id)
            if (tp) {
                this.workspaceFeature.removeTestProcess(tp)
                this.testProcesses.delete(i.id)
            }

            if (this.testFeature.juliaTestProcessOutputChannels.has(i.id)) {
                const outputChanenl = this.testFeature.juliaTestProcessOutputChannels.get(i.id)
                outputChanenl.dispose()
                this.testFeature.juliaTestProcessOutputChannels.delete(i.id)
            }
        })
        this.connection.onNotification(notificationTypeLaunchDebugger, async (i) => {
            const testRun = this.testRuns.get(i.testRunId)
            if (!testRun) {
                return
            }

            await vscode.debug.startDebugging(
                undefined,
                {
                    type: 'julia',
                    request: 'attach',
                    name: 'Julia Testitem',
                    pipename: i.debugPipeName,
                    stopOnEntry: false,
                    compiledModulesOrFunctions: this.compiledProvider.getCompiledItems(),
                    compiledMode: this.compiledProvider.compiledMode,
                },
                {
                    testRun: testRun.testRun,
                }
            )
        })
        this.connection.listen()

        this.process.stderr.on('data', (data) => {
            const dataAsString = String(data)
            this.outputChannel.append(dataAsString)
        })

        this.process.on('exit', () => {
            this.process = undefined

            if (this.connection) {
                this.connection.dispose()
                this.connection = null
            }

            this._onKilled.fire()

            for (const i of this.testRuns.values()) {
                i.testRun.end()
            }

            this.testFeature.testControllerTerminated()
        })

        this.process.on('error', (err: Error) => {
            handleNewCrashReportFromException(err, 'Extension')
            // this.launchError = err
        })

        return false
    }

    public async createTestRun(
        testRun: vscode.TestRun,
        mode: TestRunMode,
        maxProcessCount: number,
        juliaExec: JuliaExecutable,
        all_the_tests: {
            testItem: vscode.TestItem
            details: tlsp.TestItemDetail
            testEnv: tlsp.GetTestEnvRequestParamsReturn
        }[],
        testSetups: {
            packageUri: string
            name: string
            kind: string
            uri: string
            line: number
            column: number
            code: string
        }[]
    ) {
        const nthreads = inferJuliaNumThreads()

        this.currentRunExecutable = juliaExec

        const testRunId = uuidv4()

        // Group items by package identity and create one TestEnvironment per unique group.
        // `envIdByTest` is keyed by the `vscode.TestItem` itself rather than by its id: ids are
        // unique only within a package, so two checkouts of the same package share one, and
        // keying on the id would give the second item's environment to both.
        const envsByKey = new Map<
            string,
            { id: string; packageName: string; packageUri: string; projectUri?: string; envContentHash?: string }
        >()
        const envIdByTest = new Map<vscode.TestItem, string>()

        for (const t of all_the_tests) {
            const key = `${t.testEnv.packageName ?? ''}|${t.testEnv.packageUri ?? ''}|${t.testEnv.projectUri ?? ''}|${t.testEnv.envContentHash ?? ''}`
            if (!envsByKey.has(key)) {
                envsByKey.set(key, {
                    id: uuidv4(),
                    packageName: t.testEnv.packageName ?? '',
                    packageUri: t.testEnv.packageUri ?? '',
                    projectUri: t.testEnv.projectUri,
                    envContentHash: t.testEnv.envContentHash,
                })
            }
            envIdByTest.set(t.testItem, envsByKey.get(key).id)
        }

        // Must come after the grouping above, since the key needs each item's environment.
        this.testRuns.set(testRunId, {
            testRun: testRun,
            testItems: new Map(
                all_the_tests.map((i) => [testItemKey(envIdByTest.get(i.testItem), i.testItem.id), i.testItem])
            ),
        })

        const testEnvironments = [...envsByKey.values()].map((env) => ({
            id: env.id,
            juliaCmd: juliaExec.command,
            juliaArgs: juliaExec.args,
            juliaNumThreads: nthreads,
            juliaEnv: {},
            mode: modeAsString(mode),
            packageName: env.packageName,
            packageUri: env.packageUri,
            projectUri: env.projectUri,
            envContentHash: env.envContentHash,
        }))

        const workUnits = all_the_tests.map((i) => ({
            testitemId: i.testItem.id,
            testEnvId: envIdByTest.get(i.testItem),
            logLevel: 'Info',
        }))

        const params = {
            testRunId: testRunId,
            testEnvironments: testEnvironments,
            testItems: all_the_tests.map((i) => ({
                id: i.testItem.id,
                uri: i.testItem.uri.toString(),
                label: i.testItem.label,
                packageName: i.testEnv.packageName ?? '',
                packageUri: i.testEnv.packageUri ?? '',
                useDefaultUsings: i.details.optionDefaultImports,
                testSetups: i.details.optionSetup,
                line: i.details.range.start.line + 1,
                column: i.details.range.start.character + 1,
                code: i.details.code,
                codeLine: i.details.codeRange.start.line + 1,
                codeColumn: i.details.codeRange.start.character + 1,
                optionSkip: i.details.optionSkip,
            })),
            workUnits: workUnits,
            testSetups: testSetups,
            maxProcessCount: maxProcessCount,
            coverageRootUris:
                mode !== TestRunMode.Coverage || !vscode.workspace.workspaceFolders
                    ? undefined
                    : vscode.workspace.workspaceFolders.map((i) => i.uri.toString()),
        }

        // The request rejects on cancellation as well as on failure, and either way the run has
        // to be ended and its bookkeeping dropped — otherwise it spins in the Test Explorer
        // forever and the `testRuns` entry leaks.
        try {
            const testrunResult = await this.connection.sendRequest(requestTypeCreateTestRun, params, testRun.token)

            if (testrunResult.coverage) {
                for (const file of testrunResult.coverage) {
                    const uri = vscode.Uri.parse(file.uri)

                    if (
                        vscode.workspace.workspaceFolders.filter((j) => file.uri.startsWith(j.uri.toString())).length >
                        0
                    ) {
                        const statementCoverage = file.coverage
                            .map((value, index) => {
                                if (value !== null) {
                                    return new vscode.StatementCoverage(value, new vscode.Position(index, 0))
                                } else {
                                    return null
                                }
                            })
                            .filter((i) => i !== null)

                        testRun.addCoverage(vscode.FileCoverage.fromDetails(uri, statementCoverage))
                    }
                }
            }
        } finally {
            testRun.end()
            this.testRuns.delete(testRunId)
        }
    }
}

// export class TestProcess {

//     private process: ChildProcessWithoutNullStreams
//     private connection: rpc.MessageConnection
//     public testRun: vscode.TestRun | null = null
//     public launchError: Error | null = null

//     private plannedKill = false

//     private _onKilled = new vscode.EventEmitter<void>()
//     public onKilled = this._onKilled.event

//     public project_uri: lsp.URI | null = null
//     public package_uri: lsp.URI | null = null
//     public packageName: string | null = null
//     public testEnvContentHash: number

//     public debugPipename: string = generatePipeName(uuid(), 'vsc-jl-td')
//     public activeDebugSession: vscode.DebugSession | null = null

//     constructor(public coverage: boolean) {}

//     isConnected() {
//         return this.connection
//     }

//     isBusy() {
//         return this.testRun!==null
//     }

//         const nthreads = inferJuliaNumThreads()

//         if (nthreads==='auto') {
//             jlArgs.push('--threads=auto')
//         }

//         const jlEnv = {
//             JULIA_REVISE: 'off'
//         }

//         if (nthreads!=='auto' && nthreads!==undefined) {
//             jlEnv['JULIA_NUM_THREADS'] = nthreads
//         }

//     stopDebugging() {
//         if(this.activeDebugSession) {
//             vscode.debug.stopDebugging(this.activeDebugSession)
//         }
//     }
// }

export class TestFeature {
    private controller: vscode.TestController
    private testitems: WeakMap<vscode.TestItem, tlsp.TestItemDetail> = new WeakMap<
        vscode.TestItem,
        tlsp.TestItemDetail
    >()
    // Keyed by the URI string, not by `vscode.Uri`: a `Map` compares keys by identity and
    // `vscode.Uri.parse` returns a fresh object per call, so a `Uri` key would make every
    // publish add an entry instead of replacing one — leaving every historical version of a
    // file's setups in the map, all of which would then be sent on the next run.
    private testsetups: Map<string, tlsp.TestSetupDetail[]> = new Map<string, tlsp.TestSetupDetail[]>()
    // public debugPipename2TestProcess: Map<string, TestProcess> = new Map<string, TestProcess>()
    // private outputChannel: vscode.OutputChannel
    // private someTestItemFinished = new Subject()
    private cpuLength: number | null = null
    private languageClient: vslc.LanguageClient = null

    private juliaTestitemControllerOutputChannel: vscode.OutputChannel | undefined = undefined
    public juliaTestProcessOutputChannels: Map<string, vscode.OutputChannel> = new Map()
    private juliaTestController: JuliaTestController = undefined
    private profileMap: Map<vscode.TestRunProfile, { executable: JuliaExecutable; mode: TestRunMode }> = new Map()

    private initialized: boolean = false
    private initDisposable: vscode.Disposable | undefined = undefined

    constructor(
        private context: vscode.ExtensionContext,
        private executableFeature: ExecutableFeature,
        private workspaceFeature: WorkspaceFeature,
        private compiledProvider: DebugConfigTreeProvider,
        languageClientFeature: LanguageClientFeature
    ) {
        // this.outputChannel = vscode.window.createOutputChannel('Julia Testserver')
        this.juliaTestitemControllerOutputChannel = vscode.window.createOutputChannel('Julia Test Item Controller')

        this.controller = vscode.tests.createTestController('juliaTests', 'Julia Tests')

        context.subscriptions.push(
            registerCommand('language-julia.stopTestProcess', async (node: TestProcessNode) => await node.stop()),
            registerCommand('language-julia.stopTestController', async (node: TestControllerNode) => await node.stop())
        )

        // vscode.debug.onDidStartDebugSession((session: vscode.DebugSession) => {
        //     if(session.configuration.pipename && this.debugPipename2TestProcess.has(session.configuration.pipename)) {
        //         const testprocess = this.debugPipename2TestProcess.get(session.configuration.pipename)
        //         testprocess.activeDebugSession = session
        //     }
        // })

        // vscode.debug.onDidTerminateDebugSession((session: vscode.DebugSession) => {
        //     if(session.configuration.pipename && this.debugPipename2TestProcess.has(session.configuration.pipename)) {
        //         const testprocess = this.debugPipename2TestProcess.get(session.configuration.pipename)
        //         testprocess.activeDebugSession = null
        //     }
        // })

        this.cpuLength = cpus().length

        context.subscriptions.push(
            onEvent(languageClientFeature.onDidSetLanguageClient, (languageClient) => {
                this.languageClient = languageClient

                if (!this.languageClient) {
                    return
                }

                languageClient.onNotification(tlsp.notifyTypeTextDocumentPublishTests, (i) => {
                    try {
                        this.publishTestsHandler(i)
                    } catch (err) {
                        handleNewCrashReportFromException(err, 'Extension')
                        throw err
                    }
                })
            })
        )
    }

    public publishTestsHandler(params: tlsp.PublishTestsParams) {
        const uri = vscode.Uri.parse(params.uri)

        const niceFilename = vscode.workspace.asRelativePath(uri.fsPath, false)
        const shortFilename = path.basename(niceFilename)
        const filenameParts = path.dirname(niceFilename).split('/')
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri)

        if (!workspaceFolder) {
            // Test file that is outside of the workspace, we skip
            return
        }

        if (params.testItemDetails.length > 0 || params.testErrorDetails.length > 0) {
            // First see whether we already have the workspace folder
            let currentFolder = this.controller.items.get(workspaceFolder.name)
            let currentUri = workspaceFolder.uri
            if (!currentFolder) {
                currentFolder = this.controller.createTestItem(workspaceFolder.name, workspaceFolder.name, currentUri)
                this.controller.items.add(currentFolder)
            }

            for (const part of filenameParts) {
                currentUri = currentUri.with({ path: `${currentUri.path}/${part}` })
                let newChild = currentFolder.children.get(part)
                if (!newChild) {
                    newChild = this.controller.createTestItem(part, part, currentUri)
                    currentFolder.children.add(newChild)
                }
                currentFolder = newChild
            }

            let fileTestitem = currentFolder.children.get(shortFilename)
            if (!fileTestitem) {
                fileTestitem = this.controller.createTestItem(shortFilename, shortFilename, uri)
                currentFolder.children.add(fileTestitem)
            }

            fileTestitem.children.forEach((i) => this.testitems.delete(i))

            fileTestitem.children.replace([
                ...params.testItemDetails.map((i) => {
                    const testitem = this.controller.createTestItem(i.id, i.label, uri)
                    testitem.tags = i.optionTags.map((j) => new vscode.TestTag(j))
                    testitem.range = new vscode.Range(
                        i.range.start.line,
                        i.range.start.character,
                        i.range.end.line,
                        i.range.end.character
                    )

                    this.testitems.set(testitem, i)

                    return testitem
                }),
                ...params.testErrorDetails.map((i) => {
                    const testitem = this.controller.createTestItem(i.id, i.label, uri)
                    testitem.error = i.error
                    testitem.range = new vscode.Range(
                        i.range.start.line,
                        i.range.start.character,
                        i.range.end.line,
                        i.range.end.character
                    )

                    return testitem
                }),
            ])
        } else {
            let currentFolder = this.controller.items.get(workspaceFolder.name)
            if (currentFolder) {
                let foundParentFolder = true
                for (const part of filenameParts) {
                    const child = currentFolder.children.get(part)
                    if (!child) {
                        foundParentFolder = false
                        break
                    }
                    currentFolder = child
                }

                if (foundParentFolder) {
                    const fileTestitem = currentFolder.children.get(shortFilename)
                    if (fileTestitem) {
                        fileTestitem.children.forEach((i) => this.testitems.delete(i))
                        currentFolder.children.delete(shortFilename)
                    }
                }

                while (currentFolder) {
                    const parentFolder = currentFolder.parent
                    if (currentFolder.children.size === 0) {
                        if (parentFolder) {
                            parentFolder.children.delete(currentFolder.id)
                        } else {
                            this.controller.items.delete(currentFolder.id)
                        }
                    }
                    currentFolder = parentFolder
                }
            }
        }

        // Drop the entry rather than storing an empty list. Every key here becomes a
        // `getTestEnv` round-trip on every subsequent test run, and the language server
        // publishes for files with no setups at all — including ones that have just been
        // deleted — so keeping them would grow that cost for the life of the session.
        if (params.testSetupDetails.length > 0) {
            this.testsetups.set(uri.toString(), params.testSetupDetails)
        } else {
            this.testsetups.delete(uri.toString())
        }
    }

    walkTestTree(item: vscode.TestItem, itemsToRun: vscode.TestItem[]) {
        if (this.testitems.has(item)) {
            itemsToRun.push(item)
        } else {
            item.children.forEach((i) => this.walkTestTree(i, itemsToRun))
        }
    }

    isParentOf(x: vscode.TestItem, y: vscode.TestItem) {
        if (y.parent) {
            if (y.parent === x) {
                return true
            } else {
                return this.isParentOf(x, y.parent)
            }
        } else {
            return false
        }
    }

    public async init() {
        if (this.initialized) {
            return
        }

        if (!(await this.executableFeature.hasJulia())) {
            if (!this.initDisposable) {
                this.initDisposable = onEvent(this.executableFeature.onDidFindJulia, () => this.init())
                this.context.subscriptions.push(this.initDisposable)
            }
            return
        }

        this.initialized = true
        this.initDisposable?.dispose()
        this.initDisposable = undefined

        let executables
        try {
            executables = await this.executableFeature.getExecutables()
        } catch (err) {
            if (err instanceof JuliaNotFoundError) {
                // No Julia available; revert initialization so we retry on next trigger.
                this.initialized = false
                return
            }
            throw err
        }
        const hasJuliaup = executables.some((e) => e.juliaupChannel)

        const makeHandler = (executable: JuliaExecutable, mode: TestRunMode) => {
            return async (request: vscode.TestRunRequest, token: vscode.CancellationToken) => {
                try {
                    await this.runHandler(request, mode, executable, token)
                } catch (err) {
                    handleNewCrashReportFromException(err, 'Extension')
                    throw err
                }
            }
        }

        for (const executable of executables) {
            const isDefault = hasJuliaup ? (executable.juliaupChannel?.isDefault ?? false) : true
            const channelLabel = hasJuliaup
                ? (executable.juliaupChannel?.name ?? `Julia ${executable.getVersion()}`)
                : undefined
            const suffix = channelLabel ? ` (${channelLabel} channel)` : ''

            const runProfile = this.controller.createRunProfile(
                `Run${suffix}`,
                vscode.TestRunProfileKind.Run,
                makeHandler(executable, TestRunMode.Normal),
                isDefault
            )
            this.profileMap.set(runProfile, { executable, mode: TestRunMode.Normal })

            const debugProfile = this.controller.createRunProfile(
                `Debug${suffix}`,
                vscode.TestRunProfileKind.Debug,
                makeHandler(executable, TestRunMode.Debug),
                false
            )
            this.profileMap.set(debugProfile, { executable, mode: TestRunMode.Debug })

            const supportsCoverage = executable.getVersion() && semver.gte(executable.getVersion(), '1.11.0-rc2')
            if (supportsCoverage) {
                const coverageProfile = this.controller.createRunProfile(
                    `Run with coverage${suffix}`,
                    vscode.TestRunProfileKind.Coverage,
                    makeHandler(executable, TestRunMode.Coverage),
                    isDefault
                )
                coverageProfile.loadDetailedCoverage = async (_testRun, fileCoverage: OurFileCoverage) => {
                    return fileCoverage.detailedCoverage
                }
                this.profileMap.set(coverageProfile, { executable, mode: TestRunMode.Coverage })
            }
        }
    }

    async ensureJuliaTestController() {
        if (!this.juliaTestController || !this.juliaTestController.ready()) {
            this.juliaTestController = new JuliaTestController(
                this,
                this.executableFeature,
                this.workspaceFeature,
                this.context,
                this.juliaTestitemControllerOutputChannel,
                this.compiledProvider
            )

            return await this.juliaTestController.start()
        }

        return false
    }

    async testControllerTerminated() {
        this.juliaTestController = undefined
        for (const i of this.juliaTestProcessOutputChannels.values()) {
            i.dispose()
        }
    }

    async runHandler(
        request: vscode.TestRunRequest,
        mode: TestRunMode,
        executable: JuliaExecutable,
        token: vscode.CancellationToken
    ) {
        const failBecauseNoController = await this.ensureJuliaTestController()

        if (failBecauseNoController) {
            return
        }

        if (token.isCancellationRequested) {
            return
        }

        const testRun = this.controller.createTestRun(request, undefined, true)

        let itemsToRun: vscode.TestItem[] = []

        if (!request.include) {
            this.controller.items.forEach((i) => this.walkTestTree(i, itemsToRun))
        } else {
            request.include.forEach((i) => this.walkTestTree(i, itemsToRun))
        }

        if (request.exclude) {
            itemsToRun = itemsToRun.filter(
                (i) => !request.exclude.includes(i) && request.exclude.every((j) => !this.isParentOf(j, i))
            )
        }

        // Defensive: nothing in the `TestRunRequest` contract says `include` cannot name both an
        // ancestor and a descendant, and the walk above would then reach that descendant once
        // per entry. The controller rejects a run naming one test item twice outright, so a
        // duplicate here would fail the whole run rather than merely running an item twice.
        // VS Code's own tree-selection path does normalise this away today, so this is insurance
        // against a request built some other way, not a fix for an observed failure.
        itemsToRun = [...new Set(itemsToRun)]

        for (const i of itemsToRun) {
            if (i.error) {
                testRun.errored(i, new vscode.TestMessage(i.error))
            } else {
                testRun.enqueued(i)
            }
        }

        // Keyed by the URI string throughout: `vscode.Uri` values compare by object identity,
        // and the same file yields a different object every time it is parsed.
        const uniqueFiles = new Set(itemsToRun.map((i) => i.uri.toString()).concat([...this.testsetups.keys()]))

        const testEnvPerFile = new Map<string, tlsp.GetTestEnvRequestParamsReturn>()

        for (const uri of uniqueFiles) {
            const testEnv = await this.languageClient?.sendRequest(tlsp.requestTypJuliaGetTestEnv, {
                uri: uri,
            })
            testEnvPerFile.set(uri, testEnv)
        }

        const all_the_tests = itemsToRun.map((i) => {
            return {
                testItem: i,
                details: this.testitems.get(i),
                // `??  {}` because the lookup really can miss: `getTestEnv` is sent through
                // `this.languageClient?`, which yields `undefined` whenever the client is null
                // — the language server still starting, or restarting after a crash. Every
                // consumer already treats each field as optional.
                testEnv: testEnvPerFile.get(i.uri.toString()) ?? {},
            }
        })

        const all_the_testsetups: {
            packageUri: string
            name: string
            kind: string
            uri: string
            line: number
            column: number
            code: string
        }[] = []
        this.testsetups.forEach((setups, uri) => {
            setups.forEach((j) => {
                all_the_testsetups.push({
                    // `packageUri` is a required field on the wire and the Julia side reads it
                    // without a `haskey` guard, so an absent key is a `KeyError` that fails the
                    // whole `createTestRun`. `getTestEnv` legitimately reports no package for a
                    // file outside one, so fall back the same way the test item path does.
                    // The fallback does put every package-less file in one `''` namespace, and
                    // the controller keys setups by (package uri, name) — so two such files
                    // declaring a setup of the same name shadow each other instead of failing
                    // the run, which is the better of the two outcomes.
                    packageUri: testEnvPerFile.get(uri)?.packageUri ?? '',
                    name: j.name,
                    kind: j.kind,
                    uri: uri,
                    line: j.codeRange.start.line + 1,
                    column: j.codeRange.start.character + 1,
                    code: j.code,
                })
            })
        })

        let maxNumProcesses = vscode.workspace.getConfiguration('julia').get<number>('numTestProcesses')

        if (maxNumProcesses === 0) {
            maxNumProcesses = this.cpuLength
        }

        if (token.isCancellationRequested) {
            testRun.end()
            return
        }

        await this.juliaTestController.createTestRun(
            testRun,
            mode,
            maxNumProcesses,
            executable,
            all_the_tests,
            all_the_testsetups
        )
    }

    public dispose() {}
}
