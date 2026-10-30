import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as net from 'net'
import * as fs from 'node:fs/promises'
import * as path from 'path'
import { spawn } from 'child_process'
import { once } from 'events'
import * as rpc from 'vscode-jsonrpc/node'
import {
    createNativeReplSession,
    acceptsNativeSession,
    nativeReplRequest,
    NativeReplSession,
    NativeStaleGenerationError,
    stripTerminalEscapes,
    TerminalEscapeStripper,
    terminateNativeJulia,
} from '../interactive/nativeRepl'

test('strips terminal escape sequences while preserving text', () => {
    assert.equal(stripTerminalEscapes('\x1b[31mJulia\x1b[0m'), 'Julia')
    assert.equal(stripTerminalEscapes('prompt \x1b]633;A\u0007output'), 'prompt output')
    assert.equal(stripTerminalEscapes('prompt \x1b]633;A\x1b\\output'), 'prompt output')
    assert.equal(stripTerminalEscapes('é界€\n\ttext'), 'é界€\n\ttext')
    assert.equal(stripTerminalEscapes('one\rtwo\r\nthree'), 'onetwo\r\nthree')
    assert.equal(stripTerminalEscapes('x\x1b7y'), 'xy')
})

test('strips terminal escape sequences split across notifications', () => {
    const stripper = new TerminalEscapeStripper()
    assert.equal(stripper.push('red \x1b[3'), 'red ')
    assert.equal(stripper.push('1mtext\x1b[0m'), 'text')
    assert.equal(stripper.push('prompt \x1b]633;C;'), 'prompt ')
    assert.equal(stripper.push('x=1\x07output'), 'output')
})

test('flushes overlong incomplete terminal escapes as text', () => {
    const stripper = new TerminalEscapeStripper()
    const incompleteSequence = `\x1b]${'x'.repeat(4096)}`
    assert.equal(stripper.push(incompleteSequence), incompleteSequence)
})

test('session identity requires the nonce, generation, and original Julia PID', async () => {
    const session = await createNativeReplSession()
    try {
        assert.equal((await fs.stat(session.directory)).mode & 0o777, 0o700)
        const hello = { sessionId: session.id, token: session.token, generation: 1, juliaPid: 42, isEvaluating: false }
        assert.equal(acceptsNativeSession(session, hello), true)
        assert.equal(acceptsNativeSession(session, { ...hello, token: 'wrong' }), false)
        assert.equal(acceptsNativeSession(session, { ...hello, generation: 0 }), false)
        assert.equal(acceptsNativeSession({ ...session, juliaPid: 41 }, hello), false)
    } finally {
        await fs.rmdir(session.directory)
    }
})

test('control protocol rejects failure, malformed responses and timeouts', async () => {
    const session = await createNativeReplSession()
    const server = net.createServer((socket) => {
        socket.once('data', (data) => {
            const request = JSON.parse(String(data))
            if (request.generation === 2) {
                socket.end('{"ok":false}\n')
            } else if (request.generation === 3) {
                socket.end('invalid\n')
            } else {
                setTimeout(() => socket.destroy(), 100)
            }
        })
    })
    server.listen(session.controlPipe)
    await once(server, 'listening')
    try {
        await assert.rejects(nativeReplRequest({ ...session, generation: 2 }, 'reconnect'), /rejected/)
        await assert.rejects(nativeReplRequest({ ...session, generation: 3 }, 'reconnect'), /Invalid/)
        await assert.rejects(nativeReplRequest(session, 'reconnect', {}, 20), /timed out/)
    } finally {
        server.close()
        await fs.rmdir(session.directory)
    }
})

test('terminateNativeJulia signals only processes marked as terminalserver', { timeout: 10000 }, async () => {
    const marked = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)', 'terminalserver.jl'], {
        stdio: 'ignore',
    })
    await once(marked, 'spawn')
    const markedExited = once(marked, 'exit')
    try {
        assert.ok(marked.pid)
        await terminateNativeJulia(marked.pid)
        const [, signal] = await markedExited
        assert.equal(signal, 'SIGTERM')
    } finally {
        if (marked.exitCode === null) {
            marked.kill('SIGKILL')
        }
        await markedExited
    }

    const unmarked = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'ignore' })
    await once(unmarked, 'spawn')
    const unmarkedExited = once(unmarked, 'exit')
    try {
        assert.ok(unmarked.pid)
        await terminateNativeJulia(unmarked.pid)
        assert.equal(unmarked.exitCode, null)
        assert.equal(unmarked.signalCode, null)
    } finally {
        unmarked.kill('SIGTERM')
        await unmarkedExited
    }
})

test(
    'real Julia survives authenticated background reconnects, including an in-flight calculation',
    { timeout: 120000 },
    async () => {
        const session = await createNativeReplSession()
        const connections: rpc.MessageConnection[] = []
        const servers: net.Server[] = []
        async function listener(current: NativeReplSession) {
            let isEvaluating: boolean
            const pipe = path.join(session.directory, `rpc-${current.generation}.sock`)
            const debugPipe = path.join(session.directory, `debug-${current.generation}.sock`)
            let resolveHello: (value: rpc.MessageConnection) => void
            const hello = new Promise<rpc.MessageConnection>((resolve) => {
                resolveHello = resolve
            })
            const server = net.createServer((socket) => {
                const connection = rpc.createMessageConnection(
                    new rpc.StreamMessageReader(socket),
                    new rpc.StreamMessageWriter(socket)
                )
                connections.push(connection)
                connection.onNotification(new rpc.NotificationType<unknown>('connected'), (info) => {
                    assert.equal(acceptsNativeSession(current, info), true)
                    current.juliaPid = (info as { juliaPid: number }).juliaPid
                    isEvaluating = (info as { isEvaluating: boolean }).isEvaluating
                    resolveHello(connection)
                })
                connection.listen()
            })
            servers.push(server)
            server.listen(pipe)
            await once(server, 'listening')
            return {
                pipe,
                debugPipe,
                hello,
                get isEvaluating() {
                    return isEvaluating
                },
            }
        }
        const first = await listener(session)
        const source = `include("scripts/terminalserver/load_vscodeserver.jl"); VSCodeServer.start_native_repl(ARGS[1], ARGS[2])`
        const pty = `import os, pty, select, sys
pid, fd = pty.fork()
if pid == 0: os.execvp(sys.argv[1], sys.argv[1:])
while True:
    try:
        for ready in select.select([0, fd], [], [])[0]:
            data = os.read(ready, 65536)
            if not data: raise EOFError()
            os.write(fd if ready == 0 else 1, data)
    except (OSError, EOFError): break
_, status = os.waitpid(pid, 0)
sys.exit(os.waitstatus_to_exitcode(status))`
        const julia = spawn(
            'python3',
            [
                '-u',
                '-c',
                pty,
                'julia',
                '+1.12.7',
                '--startup-file=no',
                '--history-file=no',
                '-i',
                '-e',
                source,
                first.pipe,
                first.debugPipe,
            ],
            {
                cwd: process.cwd(),
                env: {
                    ...process.env,
                    TERM: 'xterm-256color',
                    JULIA_VSCODE_RECONNECT_PIPE: session.controlPipe,
                    JULIA_VSCODE_SESSION_ID: session.id,
                    JULIA_VSCODE_SESSION_TOKEN: session.token,
                },
                stdio: ['pipe', 'pipe', 'pipe'],
            }
        )
        let output = ''
        julia.stdout.on('data', (chunk) => {
            output += String(chunk)
        })
        julia.stderr.on('data', (chunk) => {
            output += String(chunk)
        })
        const exited = once(julia, 'exit')
        const code = (connection: rpc.MessageConnection, text: string) =>
            connection.sendRequest<{ inline: string; all: string; stackframe: unknown }>('repl/runcode', {
                filename: 'native-reconnect-test.jl',
                line: 0,
                column: 0,
                code: text,
                mod: 'Main',
                showCodeInREPL: false,
                showResultInREPL: false,
                showErrorInREPL: false,
                softscope: false,
            })
        try {
            const connection = await Promise.race([
                first.hello,
                exited.then(() => {
                    throw new Error(output)
                }),
            ])
            assert.match((await code(connection, 'native_marker = [11, 17]; sum(native_marker)')).all, /28/)
            const originalPid = session.juliaPid
            await assert.rejects(nativeReplRequest({ ...session, token: 'incorrect' }, 'reconnect', first), /rejected/)
            let began: () => void
            const started = new Promise<void>((resolve) => {
                began = resolve
            })
            connection.onNotification(new rpc.NotificationType('repl/starteval'), () => began())
            const calculation = code(connection, 'sleep(2); push!(native_marker, 23); sum(native_marker)')
            calculation.catch(() => undefined)
            await started
            session.generation++
            const second = await listener(session)
            await nativeReplRequest(session, 'reconnect', second)
            const reconnected = await second.hello
            assert.equal(session.juliaPid, originalPid)
            assert.equal(second.isEvaluating, true)
            assert.match((await code(reconnected, 'sum(native_marker)')).all, /51/)
            await assert.rejects(nativeReplRequest(session, 'reconnect', second), (err: unknown) => {
                assert.ok(err instanceof NativeStaleGenerationError)
                assert.equal(err.currentGeneration, session.generation)
                assert.equal(err.message, 'Julia rejected the reconnect request.')
                return true
            })
            assert.match((await code(reconnected, 'sum(native_marker)')).all, /51/)
            session.generation++
            const third = await listener(session)
            await nativeReplRequest(session, 'reconnect', third)
            const thirdConnection = await third.hello
            assert.equal(third.isEvaluating, false)
            let beganInterrupt: () => void
            const interruptStarted = new Promise<void>((resolve) => {
                beganInterrupt = resolve
            })
            const notification = thirdConnection.onNotification(new rpc.NotificationType('repl/starteval'), () =>
                beganInterrupt()
            )
            const interrupted = code(thirdConnection, 'sleep(60)')
            await interruptStarted
            notification.dispose()
            await thirdConnection.sendNotification('repl/interrupt')
            assert.match((await interrupted).all, /InterruptException/)
            let hooked = false
            for (let attempt = 0; attempt < 100 && !hooked; attempt++) {
                hooked = (await code(thirdConnection, 'VSCodeServer.HAS_REPL_TRANSFORM[]')).all.includes('true')
                if (!hooked) {
                    await new Promise((resolve) => setTimeout(resolve, 100))
                }
            }
            assert.equal(hooked, true)
            let beganControlInterrupt: () => void
            const controlStarted = new Promise<void>((resolve) => {
                beganControlInterrupt = resolve
            })
            const controlNotification = thirdConnection.onNotification(new rpc.NotificationType('repl/starteval'), () =>
                beganControlInterrupt()
            )
            const controlInterrupted = new Promise<void>((resolve) => {
                const finished = thirdConnection.onNotification(new rpc.NotificationType('repl/finisheval'), () => {
                    finished.dispose()
                    resolve()
                })
            })
            julia.stdin.write('sleep(60)\n')
            await controlStarted
            controlNotification.dispose()
            await assert.rejects(
                nativeReplRequest({ ...session, generation: session.generation - 1 }, 'interrupt'),
                /rejected/
            )
            const interruptTime = performance.now()
            await nativeReplRequest(session, 'interrupt', {}, 5000)
            await controlInterrupted
            assert.ok(performance.now() - interruptTime < 5000, 'control interrupt must not wait for sleep to finish')
            assert.match((await code(thirdConnection, 'sum(native_marker)')).all, /51/)
            session.generation++
            const headless = await listener(session)
            await nativeReplRequest(session, 'reconnect', { ...headless, headless: true })
            const headlessConnection = await headless.hello
            let headlessOutput = ''
            headlessConnection.onNotification(
                new rpc.NotificationType<{ text: string }>('repl/headlessoutput'),
                ({ text }) => {
                    headlessOutput += text
                }
            )
            const outputStarted = performance.now()
            let outputTimer: NodeJS.Timeout | undefined
            const outputRequest = code(
                headlessConnection,
                'print(repeat("x", 1_000_001)); println("\\nHEADLESS-LAST-LINE")'
            )
            outputRequest.catch(() => undefined)
            try {
                const outputTimeout = new Promise<never>((_, reject) => {
                    outputTimer = setTimeout(
                        () =>
                            reject(
                                new Error(`Headless output evaluation timed out after ${headlessOutput.length} chars.`)
                            ),
                        15000
                    )
                })
                await Promise.race([outputRequest, outputTimeout])
                assert.ok(performance.now() - outputStarted < 15000)
            } finally {
                if (outputTimer) {
                    clearTimeout(outputTimer)
                }
            }
            const outputDeadline = Date.now() + 10000
            while (
                (headlessOutput.length < 1_000_000 || !headlessOutput.includes('HEADLESS-LAST-LINE')) &&
                Date.now() < outputDeadline
            ) {
                await new Promise((resolve) => setTimeout(resolve, 50))
            }
            assert.ok(
                headlessOutput.length >= 1_000_000,
                `Expected at least 1,000,000 output chars, received ${headlessOutput.length}.`
            )
            assert.match(headlessOutput, /HEADLESS-LAST-LINE/)
            await code(headlessConnection, '@info "headless-log"')
            const logDeadline = Date.now() + 5000
            while (!headlessOutput.includes('headless-log') && Date.now() < logDeadline) {
                await new Promise((resolve) => setTimeout(resolve, 50))
            }
            assert.match(headlessOutput, /headless-log/)
            const unicodeOutputStart = headlessOutput.length
            const unicodeCode = `
                print(repeat("é", 70_000))
                print(repeat("界", 70_000))
                write(stdout, UInt8[0xe2]); flush(stdout); sleep(0.1)
                write(stdout, UInt8[0x82]); flush(stdout); sleep(0.1)
                write(stdout, UInt8[0xac]); flush(stdout)
                println("\\nUNICODE-LAST-LINE")
            `
            await code(headlessConnection, unicodeCode)
            const unicodeOutputDeadline = Date.now() + 5000
            while (
                !headlessOutput.slice(unicodeOutputStart).endsWith('\nUNICODE-LAST-LINE\n') &&
                Date.now() < unicodeOutputDeadline
            ) {
                await new Promise((resolve) => setTimeout(resolve, 50))
            }
            const unicodeOutput = headlessOutput.slice(unicodeOutputStart)
            assert.ok(unicodeOutput.includes('é'.repeat(70_000)))
            assert.ok(unicodeOutput.includes('界'.repeat(70_000)))
            assert.ok(unicodeOutput.includes('€'))
            assert.ok(!unicodeOutput.includes('\uFFFD'))
            assert.ok(unicodeOutput.includes('\nUNICODE-LAST-LINE\n'))
            session.generation++
            const restored = await listener(session)
            await nativeReplRequest(session, 'reconnect', { ...restored, headless: false })
            const restoredConnection = await restored.hello
            assert.match((await code(restoredConnection, 'stdout isa Base.TTY')).all, /true/)
            await nativeReplRequest(session, 'stop')
            assert.equal((await exited)[0], 0)
        } catch (err) {
            throw new Error(`${String(err)}\n${output}`, { cause: err })
        } finally {
            if (session.juliaPid && julia.exitCode === null) {
                try {
                    process.kill(session.juliaPid, 'SIGKILL')
                } catch (err) {
                    assert.equal((err as NodeJS.ErrnoException).code, 'ESRCH')
                }
            }
            julia.kill('SIGKILL')
            for (const connection of connections) {
                connection.dispose()
            }
            for (const server of servers) {
                server.close()
            }
            await fs.rm(session.directory, { recursive: true, force: true })
        }
    }
)
