import * as fs from 'async-file'
import { Subject } from 'await-notify'
import { assert } from 'console'
import * as net from 'net'
import { homedir } from 'os'
import * as path from 'path'
import { exec } from 'promisify-child-process'
import { uuid } from 'uuidv4'
import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc/node'
import * as vslc from 'vscode-languageclient/node'
import { onSetLanguageClient } from '../extension'
import * as jlpkgenv from '../jlpkgenv'
import { switchEnvToPath } from '../jlpkgenv'
import { JuliaExecutablesFeature } from '../juliaexepath'
import * as telemetry from '../telemetry'
import { generatePipeName, getVersionedParamsAtPosition, inferJuliaNumThreads, registerAsyncCommand, registerNonAsyncCommand, setContext, wrapCrashReporting } from '../utils'
import * as completions from './completions'
import { VersionedTextDocumentPositionParams } from './misc'
import * as modules from './modules'
import * as plots from './plots'
import * as results from './results'
import { Frame, openFile } from './results'

let g_context: vscode.ExtensionContext = null
let g_languageClient: vslc.LanguageClient = null
let g_compiledProvider = null

let g_terminal: vscode.Terminal = null

export let g_connection: rpc.MessageConnection = undefined

let g_juliaExecutablesFeature: JuliaExecutablesFeature

async function startREPLCommand() {
    telemetry.traceEvent('command-startrepl')

    await startREPL(false, true)
}
async function confirmKill() {
    if (vscode.workspace.getConfiguration('julia').get<boolean>('persistentSession.warnOnKill') === false) {
        return true
    }
    else {
        const agree = 'Yes'
        const agreeAlways = 'Yes, always'
        const disagree = 'No'
        const choice = await vscode.window.showInformationMessage('This is a persistent tmux session. Do you want to close it?', agree, agreeAlways, disagree)
        if (choice === disagree) {
            return false
        }
        if (choice === agreeAlways) {
            await vscode.workspace.getConfiguration('julia').update('persistentSession.warnOnKill', false, true)
        }
        if (choice === agree || choice === agreeAlways) {
            return true
        }
        return false
    }
}
async function stopREPL(onDeactivate=false) {
    const config = vscode.workspace.getConfiguration('julia')
    if (Boolean(config.get('persistentSession.enabled')) && !onDeactivate) {
        try {
            const sessionName = parseSessionArgs(config.get('persistentSession.tmuxSessionName'))
            const killSession = await confirmKill()
            if (killSession) {
                await exec(`tmux kill-session -t ${sessionName}`)
            }
        } catch (err) {
            await vscode.window.showErrorMessage('Failed to close tmux session: ' + err.stderr)
        }
    }
    if (isConnected()) {
        g_connection.end()
        g_connection = undefined
    }
    if (g_terminal) {
        g_terminal.dispose()
        g_terminal = null
    }
}
async function restartREPL() {
    await stopREPL()
    await startREPL(false, true)
}

function getEditor(): string {
    return vscode.workspace.getConfiguration('julia').get('editor')
}
function isConnected() {
    return Boolean(g_connection)
}

function sanitize(str: string) {
    return str.toLowerCase().replace(/[^\p{L}\p{N}_-]+/ug, '-')
}
function parseSessionArgs(name: string) {
    if (name.match(/\$\[workspace\]/)){
        const ed = vscode.window.activeTextEditor
        if (ed) {
            const folder = vscode.workspace.getWorkspaceFolder(ed.document.uri)
            if (folder) {
                return name.replace('$[workspace]', sanitize(folder.name))
            } else {
                return name.replace('$[workspace]', '')
            }
        }
    }

    return name
}

async function startREPL(preserveFocus: boolean, showTerminal: boolean = true) {
    if (isConnected()) {
        if (g_terminal && showTerminal) {
            g_terminal.show(preserveFocus)
        }
        return
    }

    const config = vscode.workspace.getConfiguration('julia')
    const terminalConfig = vscode.workspace.getConfiguration('terminal')
    if (g_terminal === null) {
        const pipename = generatePipeName(uuid(), 'vsc-jl-repl')
        const startupPath = path.join(g_context.extensionPath, 'scripts', 'terminalserver', 'terminalserver.jl')
        const nthreads = inferJuliaNumThreads()

        // remember to change ../../scripts/terminalserver/terminalserver.jl when adding/removing args here:
        function getArgs() {
            const jlarg2 = [startupPath, pipename, telemetry.getCrashReportingPipename()]
            jlarg2.push(`USE_REVISE=${config.get('useRevise')}`)
            jlarg2.push(`USE_PLOTPANE=${config.get('usePlotPane')}`)
            jlarg2.push(`USE_PROGRESS=${config.get('useProgressFrontend')}`)
            jlarg2.push(`ENABLE_SHELL_INTEGRATION=${terminalConfig.get('integrated.shellIntegration.enabled')}`)
            jlarg2.push(`DEBUG_MODE=${Boolean(process.env.DEBUG_MODE)}`)

            if (nthreads === 'auto') {
                jlarg2.splice(0, 0, '--threads=auto')
            }

            return jlarg2
        }

        const env: any = {
            JULIA_EDITOR: getEditor()
        }

        if (nthreads !== 'auto') {
            env['JULIA_NUM_THREADS'] = nthreads
        }

        const pkgServer: string = config.get('packageServer')
        if (pkgServer.length !== 0) {
            env['JULIA_PKG_SERVER'] = pkgServer
        }

        const juliaIsConnectedPromise = startREPLMsgServer(pipename)

        const juliaExecutable = await g_juliaExecutablesFeature.getActiveJuliaExecutableAsync()

        let jlarg1: string[]
        const pkgenvpath = await jlpkgenv.getAbsEnvPath()
        if (pkgenvpath === null) {
            jlarg1 = ['-i', '--banner=no'].concat(config.get('additionalArgs'))
        } else {
            const env_file_paths = await jlpkgenv.getProjectFilePaths(pkgenvpath)

            let sysImageArgs = []
            if (config.get('useCustomSysimage') && env_file_paths.sysimage_path && env_file_paths.project_toml_path && env_file_paths.manifest_toml_path) {
                const date_sysimage = await fs.stat(env_file_paths.sysimage_path)
                const date_manifest = await fs.stat(env_file_paths.manifest_toml_path)

                if (date_sysimage.mtime > date_manifest.mtime) {
                    sysImageArgs = ['-J', env_file_paths.sysimage_path]
                }
                else {
                    await vscode.window.showWarningMessage('Julia sysimage for this environment is out-of-date and not used for REPL.')
                }
            }
            jlarg1 = ['-i', '--banner=no', `--project=${pkgenvpath}`].concat(sysImageArgs).concat(config.get('additionalArgs'))
        }

        let shellPath: string, shellArgs: string[]

        if (Boolean(config.get('persistentSession.enabled'))) {
            shellPath = config.get('persistentSession.shell')
            const connectJuliaCode = juliaConnector(pipename)
            const sessionName = parseSessionArgs(config.get('persistentSession.tmuxSessionName'))
            const juliaAndArgs = `JULIA_NUM_THREADS=${env.JULIA_NUM_THREADS} JULIA_EDITOR=${getEditor()} ${juliaExecutable.file} ${[
                ...juliaExecutable.args,
                ...jlarg1,
                ...getArgs()
            ].join(' ')}`.replace(/"/g, '\\"')
            shellArgs = [
                <string>config.get('persistentSession.shellExecutionArgument'),
                // create a new tmux session, set remain-on-exit to true, and attach; if the session already exists we just attach to the existing session
                `tmux new -d -s ${sessionName} "${juliaAndArgs}" && tmux set -q remain-on-exit && tmux attach -t ${sessionName} ||
                tmux send-keys -t ${sessionName}.left ^A ^K ^H '${connectJuliaCode}' ENTER && tmux attach -t ${sessionName}`
            ]
        } else {
            shellPath = juliaExecutable.file
            shellArgs = [...juliaExecutable.args, ...jlarg1, ...getArgs()]
        }
        // start a new transient terminal
        // that option isn't available on pre 1.65 versions of VS Code,
        // so we cast the options to `any`
        g_terminal = vscode.window.createTerminal({
            name: `Julia REPL (v${juliaExecutable.getVersion()})`,
            shellPath: shellPath,
            shellArgs: shellArgs,
            isTransient: true,
            env: env,
        } as any)

        g_terminal.show(preserveFocus)
        await juliaIsConnectedPromise.wait()
    } else if (showTerminal) {
        g_terminal.show(preserveFocus)
    }
}

function juliaConnector(pipename: string, start = false) {
    const connect = `VSCodeServer.serve(raw"${pipename}"; is_dev = "DEBUG_MODE=true" in Base.ARGS, crashreporting_pipename = raw"${telemetry.getCrashReportingPipename()}");nothing # re-establishing connection with VSCode`
    if (start) {
        return `pushfirst!(LOAD_PATH, raw"${path.join(g_context.extensionPath, 'scripts', 'packages')}");using VSCodeServer;popfirst!(LOAD_PATH);` + connect
    } else {
        return connect
    }
}

async function connectREPL() {
    const pipename = generatePipeName(uuid(), 'vsc-jl-repl')
    const juliaIsConnectedPromise = startREPLMsgServer(pipename)
    const connectJuliaCode = juliaConnector(pipename, true)

    const config = vscode.workspace.getConfiguration('julia')

    if (config.get<boolean>('persistentSession.alwaysCopy')) {
        await vscode.env.clipboard.writeText(connectJuliaCode)
        await vscode.window.showInformationMessage('Start a Julia session and execute the code in your clipboard into it.')
        await _connectREPL(juliaIsConnectedPromise)
    } else {
        const copy = 'Copy code'
        const always  = 'Always copy code'
        const click = await vscode.window.showInformationMessage(
            'Start a Julia session and execute the code copied into your clipboard by the button below into it.',
            always, copy
        )
        if (click === always) {
            await config.update('persistentSession.alwaysCopy', true)
        }
        if (click) {
            await vscode.env.clipboard.writeText(connectJuliaCode)
            await _connectREPL(juliaIsConnectedPromise)
        }
    }
}

async function _connectREPL(juliaIsConnectedPromise) {
    try {
        await juliaIsConnectedPromise.wait()
        await vscode.window.showInformationMessage('Successfully connected to external Julia REPL.')
    } catch (err) {
        await vscode.window.showErrorMessage('Failed to connect to external Julia REPL.')
    }
}

async function disconnectREPL() {
    if (g_terminal) {
        await vscode.window.showInformationMessage('Cannot disconnect from integrated REPL.')
    } else {
        if (isConnected()) {
            g_connection.end()
            g_connection = undefined
        }
    }
}

async function debuggerRun(params: DebugLaunchParams) {
    await vscode.debug.startDebugging(undefined, {
        type: 'julia',
        request: 'attach',
        name: 'Julia REPL',
        code: params.code,
        file: params.filename,
        stopOnEntry: false,
        compiledModulesOrFunctions: g_compiledProvider.getCompiledItems(),
        compiledMode: g_compiledProvider.compiledMode
    })
}

async function debuggerEnter(params: DebugLaunchParams) {
    await vscode.debug.startDebugging(undefined, {
        type: 'julia',
        request: 'attach',
        name: 'Julia REPL',
        code: params.code,
        file: params.filename,
        stopOnEntry: true,
        compiledModulesOrFunctions: g_compiledProvider.getCompiledItems(),
        compiledMode: g_compiledProvider.compiledMode
    })
}

interface ReturnResult {
    inline: string,
    all: string,
    stackframe: null | Array<Frame>
}

const requestTypeReplRunCode = new rpc.RequestType<{
    filename: string,
    line: number,
    column: number,
    code: string,
    mod: string,
    showCodeInREPL: boolean,
    showResultInREPL: boolean,
    showErrorInREPL: boolean,
    softscope: boolean
}, ReturnResult, void>('repl/runcode')

interface DebugLaunchParams {
    code: string,
    filename: string
}

export const notifyTypeDisplay = new rpc.NotificationType<{ kind: string, data: any }>('display')
const notifyTypeDebuggerEnter = new rpc.NotificationType<DebugLaunchParams>('debugger/enter')
const notifyTypeDebuggerRun = new rpc.NotificationType<DebugLaunchParams>('debugger/run')
const notifyTypeReplStartDebugger = new rpc.NotificationType<{ debugPipename: string }>('repl/startdebugger')
const notifyTypeReplStartEval = new rpc.NotificationType<void>('repl/starteval')
export const notifyTypeReplFinishEval = new rpc.NotificationType<void>('repl/finisheval')
export const notifyTypeReplShowInGrid = new rpc.NotificationType<{ code: string }>('repl/showingrid')
const notifyTypeShowProfilerResult = new rpc.NotificationType<{ trace: any, typ: string }>('repl/showprofileresult')
const notifyTypeOpenFile = new rpc.NotificationType<{ path: string, line: number }>('repl/openFile')

interface Progress {
    id: { value: number },
    name: string,
    fraction: number,
    done: Boolean
}
const notifyTypeProgress = new rpc.NotificationType<Progress>('repl/updateProgress')

const g_onInit = new vscode.EventEmitter<rpc.MessageConnection>()
export const onInit = g_onInit.event
const g_onExit = new vscode.EventEmitter<Boolean>()
export const onExit = g_onExit.event
const g_onStartEval = new vscode.EventEmitter<null>()
export const onStartEval = g_onStartEval.event
const g_onFinishEval = new vscode.EventEmitter<null>()
export const onFinishEval = g_onFinishEval.event

// code execution start

function startREPLMsgServer(pipename: string) {
    const connected = new Subject()

    if (g_connection) {
        g_connection = undefined
    }

    const server = net.createServer((socket: net.Socket) => {
        socket.on('close', hadError => {
            g_onExit.fire(hadError)
            g_connection = undefined
            server.close()
        })

        g_connection = rpc.createMessageConnection(
            new rpc.StreamMessageReader(socket),
            new rpc.StreamMessageWriter(socket)
        )

        g_connection.listen()

        g_onInit.fire(g_connection)

        connected.notify()
    })

    server.listen(pipename)

    return connected
}

const g_progress_dict = {}

async function updateProgress(progress: Progress) {
    if (g_progress_dict[progress.id.value]) {
        const p = g_progress_dict[progress.id.value]
        const increment = progress.done ? 100 : (progress.fraction - p.last_fraction) * 100

        p.progress.report({
            increment: increment,
            message: progressMessage(progress, p.started)
        })
        p.last_fraction = progress.fraction

        if (progress.done) {
            p.resolve()
            delete g_progress_dict[progress.id.value]
        }
    } else {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: 'Julia',
            cancellable: true
        }, (prog, token) => {
            return new Promise(resolve => {
                g_progress_dict[progress.id.value] = {
                    progress: prog,
                    last_fraction: progress.fraction,
                    started: new Date(),
                    resolve: resolve,
                }
                token.onCancellationRequested(async ev => {
                    await interrupt()
                })
                prog.report({
                    message: progressMessage(progress)
                })
            })
        })
    }
}

function progressMessage(prog: Progress, started = null) {
    let message = prog.name
    const parenthezise = message.trim().length > 0
    if (isFinite(prog.fraction) && 0 <= prog.fraction && prog.fraction <= 1) {
        if (parenthezise) {
            message += ' ('
        }
        message += `${(prog.fraction * 100).toFixed(1)}%`
        if (started !== null) {
            const elapsed = ((new Date()).valueOf() - started) / 1000
            const remaining = (1 / prog.fraction - 1) * elapsed
            if (isFinite(remaining)) {
                message += ` - ${formattedTimePeriod(remaining)} remaining`
            }
        }
        if (parenthezise) {
            message += ')'
        }
    }
    return message
}

function formattedTimePeriod(t) {
    const seconds = Math.floor(t % 60)
    const minutes = Math.floor(t / 60 % 60)
    const hours = Math.floor(t / 60 / 60)
    let out = ''
    if (hours > 0) {
        out += `${hours}h, `
    }
    if (minutes > 0) {
        out += `${minutes}min, `
    }
    out += `${seconds}s`
    return out
}

function clearProgress() {
    for (const id in g_progress_dict) {
        g_progress_dict[id].resolve()
        delete g_progress_dict[id]
    }
}

async function display(params: { kind: string, data: any }) {
    if (params.kind === 'application/vnd.julia-vscode.diagnostics') {
        displayDiagnostics(params.data)
    } else {
        await plots.displayPlot(params)
    }
}

interface diagnosticData {
    msg: string,
    path: string,
    line?: number,
    range?: number[][],
    severity: number,
    relatedInformation?: {
        msg: string,
        path: string,
        line?: number,
        range?: number[][]
    }[]
}
const g_trace_diagnostics: Map<string, vscode.DiagnosticCollection> = new Map()
function displayDiagnostics(data: { source: string, items: diagnosticData[] }) {
    const source = data.source

    if (g_trace_diagnostics.has(source)) {
        g_trace_diagnostics.get(source).clear()
    } else {
        g_trace_diagnostics.set(source, vscode.languages.createDiagnosticCollection('Julia Runtime Diagnostics: ' + source))
    }

    const items = data.items
    if (items.length === 0) {
        return _clearDiagnostic(source)
    }

    const diagnostics = items.map((frame): [vscode.Uri, vscode.Diagnostic[]] => {
        const range = frame.range ?
            new vscode.Range(frame.range[0][0] - 1, frame.range[0][1], frame.range[1][0] - 1, frame.range[1][1]) :
            new vscode.Range(frame.line - 1, 0, frame.line - 1, 99999)
        const diagnostic = new vscode.Diagnostic(
            range,
            frame.msg,
            frame.severity === undefined ? vscode.DiagnosticSeverity.Warning : frame.severity
        )
        if (frame.relatedInformation) {
            diagnostic.relatedInformation = frame.relatedInformation.map(stackframe => {
                const range = stackframe.range ?
                    new vscode.Range(stackframe.range[0][0] - 1, stackframe.range[0][1], stackframe.range[1][0] - 1, stackframe.range[1][1]) :
                    new vscode.Range(stackframe.line - 1, 0, stackframe.line - 1, 99999)
                return new vscode.DiagnosticRelatedInformation(
                    new vscode.Location(vscode.Uri.file(stackframe.path), range),
                    stackframe.msg
                )
            })
        }
        diagnostic.source = source

        return [
            vscode.Uri.file(frame.path),
            [
                diagnostic
            ]
        ]
    })
    g_trace_diagnostics.get(source).set(diagnostics)
}

function clearDiagnostics() {
    g_trace_diagnostics.forEach((_, source) => _clearDiagnostic(source))
}

async function clearDiagnosticsByProvider() {
    const sources = Array(...g_trace_diagnostics.keys())
    const source = await vscode.window.showQuickPick(sources, {
        // canPickMany: true, // not work nicely with keyboard shortcuts
        title: 'Select sources of diagnostics to filter them out.'
    })

    if (source) {
        _clearDiagnostic(source)
    }
}

function _clearDiagnostic(source: string) {
    const diagnostics = g_trace_diagnostics.get(source)
    diagnostics.clear()
    diagnostics.dispose()
    g_trace_diagnostics.delete(source)
}

function stripMarkdown(code: string) {
    let out = ''
    let isJulia = false
    for (const line of code.split('\n')) {
        if (/^```julia/.test(line)) {
            isJulia = true
            out += '\n'
            continue
        }
        if (isJulia) {
            if (/^```/.test(line)) {
                isJulia = false
                out += '\n'
                continue
            }
            out += line + '\n'
        } else {
            out += '\n'
        }
    }
    return out
}

async function executeFile(uri?: vscode.Uri | string) {
    telemetry.traceEvent('command-executeFile')

    const editor = vscode.window.activeTextEditor

    await startREPL(true, false)

    let module = 'Main'
    let path = ''
    let code = ''

    if (uri && !(uri instanceof vscode.Uri)) {
        uri = vscode.Uri.parse(uri)
    }

    let isJmd = false

    if (uri && uri instanceof vscode.Uri) {
        path = uri.fsPath
        const readBytes = await vscode.workspace.fs.readFile(uri)
        code = Buffer.from(readBytes).toString('utf8')
        isJmd = path.endsWith('.jmd') || path.endsWith('.md')
    }  else {
        if (!editor) {
            return
        }
        path = editor.document.fileName
        code = editor.document.getText()

        const pos = editor.document.validatePosition(new vscode.Position(0, 1)) // xref: https://github.com/julia-vscode/julia-vscode/issues/1500
        module = await modules.getModuleForEditor(editor.document, pos)
        isJmd = isMarkdownEditor(editor)
    }

    // strip out non-code-block condent for JMD files:
    if (isJmd) {
        code = stripMarkdown(code)
    }

    await g_connection.sendRequest(
        requestTypeReplRunCode,
        {
            filename: path,
            line: 0,
            column: 0,
            mod: module,
            code: code,
            showCodeInREPL: false,
            showResultInREPL: true,
            showErrorInREPL: true,
            softscope: false
        }
    )
}

async function getBlockRange(params: VersionedTextDocumentPositionParams): Promise<vscode.Position[]> {
    const zeroPos = new vscode.Position(0, 0)
    const zeroReturn = [zeroPos, zeroPos, params.position]

    try {
        return (await g_languageClient.sendRequest<vscode.Position[]>('julia/getCurrentBlockRange', params)).map(pos => new vscode.Position(pos.line, pos.character))
    } catch (err) {
        if (err.message === 'Language client is not ready yet') {
            await vscode.window.showErrorMessage(err.message)
        } else {
            console.error(err)
            await vscode.window.showErrorMessage('Error while communicating with the LS. Check Outputs > Julia Language Server for additional information.')
        }
        return zeroReturn
    }
}

async function selectJuliaBlock() {
    telemetry.traceEvent('command-selectCodeBlock')

    const editor = vscode.window.activeTextEditor
    const position = editor.document.validatePosition(editor.selection.start)
    const ret_val = await getBlockRange(getVersionedParamsAtPosition(editor.document, position))

    const start_pos = new vscode.Position(ret_val[0].line, ret_val[0].character)
    const end_pos = new vscode.Position(ret_val[1].line, ret_val[1].character)
    validateMoveAndReveal(editor, start_pos, end_pos)
}

let g_cellDelimiters = [
    /^##(?!#)/,
    /^#(\s?)%%/
]

function isCellBorder(s: string, isStart: boolean, isJmd: boolean) {
    if (isJmd) {
        if (isStart) {
            return /^```julia/.test(s)
        } else {
            return /^```(?!\w)/.test(s)
        }
    }
    return g_cellDelimiters.some(regex => regex.test(s))
}

function _nextCellBorder(doc: vscode.TextDocument, line: number, direction: number, isStart: boolean, isJmd: boolean) {
    assert(direction === 1 || direction === -1)
    while (0 <= line && line < doc.lineCount) {
        if (isCellBorder(doc.lineAt(line).text, isStart, isJmd)) {
            break
        }
        line += direction
    }
    return line
}

const nextCellBorder = (doc, line, isStart, isJmd) => _nextCellBorder(doc, line, +1, isStart, isJmd)
const prevCellBorder = (doc, line, isStart, isJmd) => _nextCellBorder(doc, line, -1, isStart, isJmd)

function validateMoveAndReveal(editor: vscode.TextEditor, startpos: vscode.Position, endpos: vscode.Position) {
    const doc = editor.document
    startpos = doc.validatePosition(startpos)
    endpos = doc.validatePosition(endpos)
    editor.selection = new vscode.Selection(startpos, endpos)
    editor.revealRange(new vscode.Range(startpos, endpos))
}

function moveCellDown() {
    telemetry.traceEvent('command-moveCellDown')
    const ed = vscode.window.activeTextEditor
    if (ed === undefined) {
        return
    }
    const isJmd = isMarkdownEditor(ed)
    const currline = ed.selection.active.line
    const newpos = new vscode.Position(nextCellBorder(ed.document, currline + 1, true, isJmd) + 1, 0)
    validateMoveAndReveal(ed, newpos, newpos)
}

function moveCellUp() {
    telemetry.traceEvent('command-moveCellUp')
    const ed = vscode.window.activeTextEditor
    if (ed === undefined) {
        return
    }
    const isJmd = isMarkdownEditor(ed)
    const currline = ed.selection.active.line

    let newpos: vscode.Position
    if (isJmd) {
        const prevEnd = Math.max(0, prevCellBorder(ed.document, currline, false, isJmd))
        const prevStart = Math.max(0, prevCellBorder(ed.document, currline, true, isJmd))

        if (prevEnd <= prevStart) {
            newpos = new vscode.Position(Math.max(0, prevCellBorder(ed.document, prevStart - 1, true, isJmd) + 1), 0)
        } else {
            newpos = new vscode.Position(prevStart + 1, 0)
        }
    } else {
        newpos = new vscode.Position(Math.max(0, prevCellBorder(ed.document, currline, true, isJmd) - 1), 0)
    }
    validateMoveAndReveal(ed, newpos, newpos)
}

function currentCellRange(editor: vscode.TextEditor) {
    const doc = editor.document
    const currline = editor.selection.active.line
    const isJmd = isMarkdownEditor(editor)
    const startline = prevCellBorder(doc, currline, true, isJmd) + 1
    if (isJmd && startline === 0) {
        return null
    }
    const endline = nextCellBorder(doc, startline + 1, false, isJmd) - 1
    if (startline > currline || endline < currline) {
        return null
    }
    const startpos = doc.validatePosition(new vscode.Position(startline, 0))
    const endpos = doc.validatePosition(new vscode.Position(endline, doc.lineAt(endline).text.length))
    return new vscode.Range(startpos, endpos)
}

async function executeCell(shouldMove: boolean = false) {
    telemetry.traceEvent('command-executeCell')

    const ed = vscode.window.activeTextEditor
    if (ed === undefined) {
        return
    }
    if (vscode.workspace.getConfiguration('julia').get<boolean>('execution.saveOnEval') === true) {
        await ed.document.save()
    }

    const doc = ed.document
    const selection = ed.selection
    const cellrange = currentCellRange(ed)
    if (cellrange === null) {
        return
    }

    const module: string = await modules.getModuleForEditor(ed.document, cellrange.start)

    await startREPL(true, false)

    if (shouldMove && ed.selection === selection) {
        const isJmd = isMarkdownEditor(ed)
        const nextpos = new vscode.Position(nextCellBorder(doc, cellrange.end.line + 1, true, isJmd) + 1, 0)
        validateMoveAndReveal(ed, nextpos, nextpos)
    }
    if (vscode.workspace.getConfiguration('julia').get<boolean>('execution.inlineResultsForCellEvaluation') === true) {
        let currentPos: vscode.Position = ed.document.validatePosition(new vscode.Position(cellrange.start.line , cellrange.start.character + 1))
        let lastRange = new vscode.Range(0, 0, 0, 0)
        while (currentPos.line <= cellrange.end.line) {
            const [startPos, endPos, nextPos] = await getBlockRange(getVersionedParamsAtPosition(ed.document, currentPos))
            const lineEndPos = ed.document.validatePosition(new vscode.Position(endPos.line, Infinity))
            const curRange = cellrange.intersection(new vscode.Range(startPos, lineEndPos))
            if (curRange === undefined || curRange.isEqual(lastRange)) {
                break
            }
            lastRange = curRange
            if (curRange.isEmpty) {
                continue
            }
            currentPos = ed.document.validatePosition(nextPos)
            const code = doc.getText(curRange)

            const success = await evaluate(ed, curRange, code, module)
            if (!success) {
                break
            }
        }
    } else {
        const code = doc.getText(cellrange)
        await evaluate(ed, cellrange, code, module)
    }
}

async function evaluateBlockOrSelection(shouldMove: boolean = false) {
    telemetry.traceEvent('command-executeCodeBlockOrSelection')


    const editor = vscode.window.activeTextEditor
    if (editor === undefined) {
        return
    }
    if (vscode.workspace.getConfiguration('julia').get<boolean>('execution.saveOnEval') === true) {
        await editor.document.save()
    }
    const selections = editor.selections.slice()

    await startREPL(true, false)

    for (const selection of selections) {
        let range: vscode.Range = null
        let nextBlock: vscode.Position = null
        const cursorPos: vscode.Position = editor.document.validatePosition(new vscode.Position(selection.start.line, selection.start.character))
        const module: string = await modules.getModuleForEditor(editor.document, cursorPos)

        if (selection.isEmpty) {
            const [startPos, endPos, nextPos] = await getBlockRange(getVersionedParamsAtPosition(editor.document, cursorPos))
            const blockStartPos = editor.document.validatePosition(startPos)
            const lineEndPos = editor.document.validatePosition(new vscode.Position(endPos.line, Infinity))
            range = new vscode.Range(blockStartPos, lineEndPos)
            nextBlock = editor.document.validatePosition(nextPos)
        } else {
            range = new vscode.Range(selection.start, selection.end)
        }

        const text = editor.document.getText(range)

        if (shouldMove && nextBlock && selection.isEmpty && editor.selections.length === 1 && editor.selection === selection) {
            validateMoveAndReveal(editor, nextBlock, nextBlock)
        }

        if (range.isEmpty) {
            return
        }

        const tempDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.hoverHighlightBackground'),
            isWholeLine: true
        })
        editor.setDecorations(tempDecoration, [range])

        setTimeout(() => {
            editor.setDecorations(tempDecoration, [])
        }, 200)

        const success = await evaluate(editor, range, text, module)

        if (!success) {
            break
        }
    }
}

// Returns false if the connection wasn't available
async function evaluate(editor: vscode.TextEditor, range: vscode.Range, text: string, module: string) {
    telemetry.traceEvent('command-evaluate')

    const section = vscode.workspace.getConfiguration('julia')
    const resultType: string = section.get('execution.resultType')
    const codeInREPL: boolean = section.get('execution.codeInREPL')

    if (!g_connection) {
        return false
    }

    let r: results.Result = null
    if (resultType !== 'REPL') {
        r = results.addResult(editor, range, ' ⟳ ', '')
    }
    try {
        const result: ReturnResult = await g_connection.sendRequest(
            requestTypeReplRunCode,
            {
                filename: editor.document.fileName,
                line: range.start.line,
                column: range.start.character,
                code: text,
                mod: module,
                showCodeInREPL: codeInREPL,
                showResultInREPL: resultType === 'REPL' || resultType === 'both',
                showErrorInREPL: resultType.indexOf('error') > -1,
                softscope: true
            }
        )
        const isError = Boolean(result.stackframe)

        if (resultType !== 'REPL') {
            if (r.destroyed && r.text === editor.document.getText(r.range)) {
                r = results.addResult(editor, range, '', '')
            }
            if (isError) {
                results.clearStackTrace()
                results.setStackTrace(r, result.all, result.stackframe)
            }
            r.setContent(results.resultContent(' ' + result.inline + ' ', result.all, isError))
        }

        return !isError
    } catch (err) {
        r.remove(true)
        throw(err)
    }
}

async function executeCodeCopyPaste(text: string, individualLine: boolean) {
    if (!text.endsWith('\n')) {
        text = text + '\n'
    }

    await startREPL(true, true)

    let lines = text.split(/\r?\n/)
    lines = lines.filter(line => line !== '')
    text = lines.join('\n')
    if (individualLine || process.platform === 'win32') {
        g_terminal.sendText(text + '\n', false)
    }
    else {
        g_terminal.sendText('\u001B[200~' + text + '\n' + '\u001B[201~', false)
    }
}

async function executeSelectionCopyPaste() {
    telemetry.traceEvent('command-executeSelectionCopyPaste')

    const editor = vscode.window.activeTextEditor
    if (!editor) {
        return
    }

    const selection = editor.selection

    const text = selection.isEmpty ? editor.document.lineAt(selection.start.line).text : editor.document.getText(selection)

    // If no text was selected, try to move the cursor to the end of the next line
    if (selection.isEmpty) {
        for (let line = selection.start.line + 1; line < editor.document.lineCount; line++) {
            if (!editor.document.lineAt(line).isEmptyOrWhitespace) {
                const newPos = selection.active.with(line, editor.document.lineAt(line).range.end.character)
                const newSel = new vscode.Selection(newPos, newPos)
                editor.selection = newSel
                break
            }
        }
    }
    await executeCodeCopyPaste(text, selection.isEmpty)
}

export async function executeInREPL(code: string, { filename = 'code', line = 0, column = 0, mod = 'Main', showCodeInREPL = true, showResultInREPL = true, showErrorInREPL = false, softscope = true }): Promise<ReturnResult> {
    await startREPL(true)
    return await g_connection.sendRequest(
        requestTypeReplRunCode,
        {
            filename,
            line,
            column,
            code,
            mod,
            showCodeInREPL,
            showResultInREPL,
            showErrorInREPL,
            softscope
        }
    )
}

const interrupts = []
let last_interrupt_index = -1
async function interrupt() {
    telemetry.traceEvent('command-interrupt')
    // always send out internal interrupt
    await softInterrupt()
    // but we'll try sending a SIGINT if more than 3 interrupts were sent in the last second
    last_interrupt_index = (last_interrupt_index + 1) % 5
    interrupts[last_interrupt_index] = new Date()
    const now = new Date()
    if (interrupts.filter(x => (now.getTime() - x.getTime()) < 1000).length >= 3) {
        await signalInterrupt()
    }
}

async function softInterrupt() {
    try {
        await g_connection.sendNotification('repl/interrupt')
    } catch (err) {
        console.warn(err)
    }
}

async function signalInterrupt() {
    telemetry.traceEvent('command-signal-interrupt')
    try {
        if (process.platform !== 'win32') {
            const pid = await g_terminal.processId
            process.kill(pid, 'SIGINT')
        } else {
            console.warn('Signal interrupts are not supported on Windows.')
        }
    } catch (err) {
        console.warn(err)
    }
}

// code execution end

async function cdToHere(uri: vscode.Uri) {
    telemetry.traceEvent('command-cdHere')

    const uriPath = await getDirUriFsPath(uri)
    await startREPL(true, false)
    if (uriPath) {
        try {
            await g_connection.sendNotification('repl/cd', { uri: uriPath })
        } catch (err) {
            console.log(err)
        }
    }
}

async function activateHere(uri: vscode.Uri) {
    telemetry.traceEvent('command-activateThisEnvironment')

    const uriPath = await getDirUriFsPath(uri)
    await activatePath(uriPath)
}

async function activatePath(path: string) {
    await startREPL(true, false)
    if (path) {
        try {
            await g_connection.sendNotification('repl/activateProject', { uri: path })
            await switchEnvToPath(path, true)
        } catch (err) {
            console.log(err)
        }
    }
}

async function activateFromDir(uri: vscode.Uri) {
    const uriPath = await getDirUriFsPath(uri)
    if (uriPath) {
        try {
            const target = await searchUpFile('Project.toml', uriPath)
            if (!target) {
                await vscode.window.showWarningMessage(`No project file found for ${uriPath}`)
                return
            }
            await activatePath(path.dirname(target))
        } catch (err) {
            console.log(err)
        }
    }
}

async function searchUpFile(target: string, from: string): Promise<string> {
    const parentDir = path.dirname(from)
    if (parentDir === from) {
        return undefined // ensure to escape infinite recursion
    } else {
        const p = path.join(from, target)
        return (await fs.exists(p)) ? p : searchUpFile(target, parentDir)
    }
}

async function getDirUriFsPath(uri: vscode.Uri | undefined) {
    if (!uri) {
        const ed = vscode.window.activeTextEditor
        if (ed && ed.document && ed.document.uri) {
            uri = ed.document.uri
        }
    }
    if (!uri || !uri.fsPath) {
        return undefined
    }

    const uriPath = uri.fsPath
    const stat = await fs.stat(uriPath)
    if (stat.isFile()) {
        return path.dirname(uriPath)
    } else if (stat.isDirectory()) {
        return uriPath
    } else {
        return undefined
    }
}

async function linkHandler(link: any) {
    let file = link.data.file
    const line = link.data.line

    if (file.startsWith('.')) {
        // Base file
        const exe = await g_juliaExecutablesFeature.getActiveJuliaExecutableAsync()
        file = path.join(await exe.getBaseRootFolderPathAsync(), file)
    } else if (file.startsWith('~')) {
        file = path.join(homedir(), file.slice(1))
    }
    try {
        await openFile(file, line)
    } catch (err) {
        console.debug('This file does not exist.')
    }
}

function linkProvider(context: vscode.TerminalLinkContext, token: vscode.CancellationToken) {
    const line = context.line
    // Can't link to the REPL
    if (/\bREPL\[\d+\]/.test(line)) {
        return []
    }

    const match = line.match(/(@\s+(?:[^\s/\\]+\s+)?)(.+?):(\d+)/)
    if (match) {
        return [
            {
                startIndex: match.index + match[1].length,
                length: match[0].length - match[1].length,
                data: {
                    file: match[2],
                    line: match[3]
                }
            }
        ]
    }
    return []
}

function updateCellDelimiters() {
    const delims: string[] = vscode.workspace.getConfiguration('julia').get('cellDelimiters')
    if (delims) {
        g_cellDelimiters = delims.map(s => RegExp(s))
    }
}

function isMarkdownEditor(editor: vscode.TextEditor) {
    return editor.document.languageId === 'juliamarkdown' || editor.document.languageId === 'markdown'
}

export async function replStartDebugger(pipename: string) {
    await startREPL(true)

    await g_connection.sendNotification(notifyTypeReplStartDebugger, { debugPipename: pipename })
}

export async function activate(context: vscode.ExtensionContext, compiledProvider, juliaExecutablesFeature: JuliaExecutablesFeature, profilerFeature) {
    g_context = context
    g_juliaExecutablesFeature = juliaExecutablesFeature

    g_compiledProvider = compiledProvider

    context.subscriptions.push(
        // listeners
        onSetLanguageClient(languageClient => {
            g_languageClient = languageClient
        }),
        onInit(wrapCrashReporting(async connection => {
            connection.onNotification(notifyTypeDisplay, display)
            connection.onNotification(notifyTypeDebuggerRun, debuggerRun)
            connection.onNotification(notifyTypeDebuggerEnter, debuggerEnter)
            connection.onNotification(notifyTypeReplStartEval, () => g_onStartEval.fire(null))
            connection.onNotification(notifyTypeReplFinishEval, () => g_onFinishEval.fire(null))
            connection.onNotification(notifyTypeShowProfilerResult, (data) => profilerFeature.showTrace({
                data: data.trace,
                type: data.typ
            }))
            connection.onNotification(notifyTypeOpenFile, ({ path, line }) => openFile(path, line))
            connection.onNotification(notifyTypeProgress, updateProgress)
            await setContext('julia.isEvaluating', false)
            await setContext('julia.hasREPL', true)
        })),
        onExit(async () => {
            setContext('julia.isEvaluating', false)
            setContext('julia.hasREPL', true)
        })),
        onExit(() => {
            results.removeAll()
            clearDiagnostics()
            await setContext('julia.isEvaluating', false)
            await setContext('julia.hasREPL', false)
        }),
        onStartEval(async () => {
            await updateProgress({
                name: 'Evaluating…',
                id: { value: -1 },
                fraction: -1,
                done: false
            })
            await setContext('julia.isEvaluating', true)
        }),
        onFinishEval(async () => {
            clearProgress()
            await setContext('julia.isEvaluating', false)
        }),
        vscode.workspace.onDidChangeConfiguration(async event => {
            if (event.affectsConfiguration('julia.usePlotPane')) {
                try {
                    await g_connection.sendNotification('repl/togglePlotPane', { enable: vscode.workspace.getConfiguration('julia').get('usePlotPane') })
                } catch (err) {
                    console.warn(err)
                }
            } else if (event.affectsConfiguration('julia.useProgressFrontend')) {
                try {
                    await g_connection.sendNotification('repl/toggleProgress', { enable: vscode.workspace.getConfiguration('julia').get('useProgressFrontend') })
                } catch (err) {
                    console.warn(err)
                }
            } else if (event.affectsConfiguration('julia.showRuntimeDiagnostics')) {
                try {
                    await g_connection.sendNotification('repl/toggleDiagnostics', { enable: vscode.workspace.getConfiguration('julia').get('showRuntimeDiagnostics') })
                } catch (err) {
                    console.warn(err)
                }
            } else if (event.affectsConfiguration('julia.cellDelimiters')) {
                updateCellDelimiters()
            }
        }),
        vscode.window.onDidChangeActiveTerminal(async terminal => {
            if (terminal === g_terminal) {
                await setContext('julia.isActiveREPL', true)
            } else {
                await setContext('julia.isActiveREPL', false)
            }
        }),
        vscode.window.onDidCloseTerminal(terminal => {
            if (terminal === g_terminal) {
                g_terminal = null
            }
        }),
        // link handler
        vscode.window.registerTerminalLinkProvider({
            provideTerminalLinks: linkProvider,
            handleTerminalLink: linkHandler
        }),
        // commands
        registerAsyncCommand('language-julia.startREPL', startREPLCommand),
        registerAsyncCommand('language-julia.connectREPL', connectREPL),
        registerAsyncCommand('language-julia.stopREPL', stopREPL),
        registerAsyncCommand('language-julia.restartREPL', restartREPL),
        registerAsyncCommand('language-julia.disconnectREPL', disconnectREPL),
        registerAsyncCommand('language-julia.selectBlock', selectJuliaBlock),
        registerAsyncCommand('language-julia.executeCodeBlockOrSelection', evaluateBlockOrSelection),
        registerAsyncCommand('language-julia.executeCodeBlockOrSelectionAndMove', async () => await evaluateBlockOrSelection(true)),
        registerAsyncCommand('language-julia.executeCell', executeCell),
        registerAsyncCommand('language-julia.executeCellAndMove', async () => await executeCell(true)),
        registerNonAsyncCommand('language-julia.moveCellUp', moveCellUp),
        registerNonAsyncCommand('language-julia.moveCellDown', moveCellDown),
        registerAsyncCommand('language-julia.executeActiveFile', async () => await executeFile()),
        registerAsyncCommand('language-julia.executeFile', async (uri: vscode.Uri | string) => await executeFile(uri)),
        registerAsyncCommand('language-julia.interrupt', interrupt),
        registerAsyncCommand('language-julia.executeJuliaCodeInREPL', executeSelectionCopyPaste), // copy-paste selection into REPL. doesn't require LS to be started
        registerAsyncCommand('language-julia.cdHere', cdToHere),
        registerAsyncCommand('language-julia.activateHere', activateHere),
        registerAsyncCommand('language-julia.activateFromDir', activateFromDir),
        registerNonAsyncCommand('language-julia.clearRuntimeDiagnostics', clearDiagnostics),
        registerAsyncCommand('language-julia.clearRuntimeDiagnosticsByProvider', clearDiagnosticsByProvider),
    )

    const terminalConfig = vscode.workspace.getConfiguration('terminal.integrated')
    const shellSkipCommands: Array<String> = terminalConfig.get('commandsToSkipShell')
    if (shellSkipCommands.indexOf('language-julia.interrupt') === -1) {
        shellSkipCommands.push('language-julia.interrupt')
        await terminalConfig.update('commandsToSkipShell', shellSkipCommands, true)
    }

    updateCellDelimiters()

    await results.activate(context)
    plots.activate(context)
    await modules.activate(context)
    completions.activate(context)
}

export function deactivate() {
    return stopREPL(true)
}
