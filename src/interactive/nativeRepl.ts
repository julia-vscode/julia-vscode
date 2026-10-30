import { randomBytes, randomUUID } from 'crypto'
import * as fs from 'node:fs/promises'
import * as net from 'net'
import { tmpdir } from 'os'
import * as path from 'path'

const terminalEscapeCarryLimit = 4096

function stripTerminalEscapesChunk(text: string) {
    const parts: string[] = []
    let index = 0
    let segmentStart = 0
    const incomplete = (start: number) => ({
        text: parts.join(''),
        carry: text.slice(start),
    })

    while (index < text.length) {
        const character = text[index]
        if (character !== '\x1b' && character !== '\r') {
            index++
            continue
        }

        parts.push(text.slice(segmentStart, index))
        if (character === '\r') {
            if (index + 1 === text.length) {
                return incomplete(index)
            }
            if (text[index + 1] === '\n') {
                parts.push('\r\n')
                index += 2
            } else {
                index++
            }
            segmentStart = index
            continue
        }

        if (index + 1 === text.length) {
            return incomplete(index)
        }
        const introducer = text[index + 1]
        if (introducer === '[') {
            let end = index + 2
            while (end < text.length) {
                const code = text.charCodeAt(end)
                if (code >= 0x40 && code <= 0x7e) {
                    break
                }
                end++
            }
            if (end === text.length) {
                return incomplete(index)
            }
            index = end + 1
            segmentStart = index
            continue
        }
        if (introducer === ']') {
            let end = index + 2
            let terminated = false
            while (end < text.length) {
                if (text.charCodeAt(end) === 0x07) {
                    end++
                    terminated = true
                    break
                }
                if (text.charCodeAt(end) === 0x1b && text.charCodeAt(end + 1) === 0x5c) {
                    end += 2
                    terminated = true
                    break
                }
                end++
            }
            if (!terminated) {
                return incomplete(index)
            }
            index = end
            segmentStart = index
            continue
        }

        index += introducer === '\n' || introducer === '\t' ? 1 : 2
        segmentStart = index
    }

    parts.push(text.slice(segmentStart))
    return { text: parts.join(''), carry: '' }
}

export function stripTerminalEscapes(text: string): string {
    const result = stripTerminalEscapesChunk(text)
    return result.text + (result.carry.startsWith('\x1b') ? result.carry : '')
}

export class TerminalEscapeStripper {
    private carry = ''

    push(text: string): string {
        const result = stripTerminalEscapesChunk(this.carry + text)
        this.carry = ''
        if (result.carry.length > terminalEscapeCarryLimit) {
            return result.text + result.carry
        }
        this.carry = result.carry
        return result.text
    }
}

export interface NativeReplSession {
    id: string
    token: string
    directory: string
    controlPipe: string
    generation: number
    terminalPid?: number
    juliaPid?: number
}

export class NativeStaleGenerationError extends Error {
    readonly currentGeneration: number

    constructor(currentGeneration: number) {
        super('Julia rejected the reconnect request.')
        this.name = 'NativeStaleGenerationError'
        this.currentGeneration = currentGeneration
    }
}

export async function createNativeReplSession(): Promise<NativeReplSession> {
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'vsc-jl-native-'))
    await fs.chmod(directory, 0o700)
    return {
        id: randomUUID(),
        token: randomBytes(32).toString('hex'),
        directory,
        controlPipe: path.join(directory, 'control.sock'),
        generation: 1,
    }
}

export async function removeNativeReplSession(session: NativeReplSession) {
    if (
        path.dirname(session.controlPipe) !== session.directory ||
        !path.basename(session.directory).startsWith('vsc-jl-native-')
    ) {
        return
    }
    await fs.unlink(session.controlPipe).catch(() => undefined)
    await fs.rmdir(session.directory).catch(() => undefined)
}

export function acceptsNativeSession(
    session: NativeReplSession,
    value: unknown
): value is { juliaPid: number; isEvaluating: boolean } {
    if (!value || typeof value !== 'object') {
        return false
    }
    const info = value as Record<string, unknown>
    return (
        info.sessionId === session.id &&
        info.token === session.token &&
        info.generation === session.generation &&
        typeof info.isEvaluating === 'boolean' &&
        Number.isSafeInteger(info.juliaPid) &&
        (info.juliaPid as number) > 0 &&
        (session.juliaPid === undefined || info.juliaPid === session.juliaPid)
    )
}

export function nativeReplRequest(
    session: NativeReplSession,
    operation: 'reconnect' | 'stop' | 'interrupt',
    endpoints: { pipe?: string; debugPipe?: string; headless?: boolean } = {},
    timeout = 60000
): Promise<void> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(session.controlPipe)
        let response = ''
        let finished = false
        const finish = (error?: Error) => {
            if (finished) {
                return
            }
            finished = true
            clearTimeout(timer)
            socket.destroy()
            if (error) {
                reject(error)
            } else {
                resolve()
            }
        }
        const timer = setTimeout(
            () => finish(new Error('Julia reconnection timed out. The existing session was not replaced.')),
            timeout
        )
        socket.setEncoding('utf8')
        socket.on('connect', () =>
            socket.write(
                JSON.stringify({
                    operation,
                    sessionId: session.id,
                    token: session.token,
                    generation: session.generation,
                    ...endpoints,
                }) + '\n'
            )
        )
        socket.on('data', (chunk: string) => {
            response += chunk
            if (response.length > 8192) {
                finish(new Error('Invalid Julia reconnect response.'))
            } else if (response.includes('\n')) {
                try {
                    const result = JSON.parse(response.slice(0, response.indexOf('\n')))
                    if (result.ok === true) {
                        finish()
                    } else if (result.reason === 'stale' && Number.isSafeInteger(result.generation)) {
                        finish(new NativeStaleGenerationError(result.generation))
                    } else {
                        finish(new Error('Julia rejected the reconnect request.'))
                    }
                } catch {
                    finish(new Error('Invalid Julia reconnect response.'))
                }
            }
        })
        socket.on('error', () =>
            finish(new Error('Cannot reach the existing Julia session. Use Stop REPL before starting a replacement.'))
        )
        socket.on('close', () => finish(new Error('Julia disconnected before acknowledging reconnection.')))
    })
}

async function hasNativeReplProcessMarker(pid: number) {
    try {
        const cmdline = await fs.readFile(`/proc/${pid}/cmdline`)
        return cmdline.toString().split('\0').some((argument) => argument.includes('terminalserver.jl'))
    } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'ESRCH') {
            return false
        }
        throw err
    }
}

function isProcessGone(err: unknown) {
    return (err as NodeJS.ErrnoException).code === 'ESRCH'
}

export async function terminateNativeJulia(pid: number): Promise<void> {
    if (!Number.isSafeInteger(pid) || pid <= 0 || !(await hasNativeReplProcessMarker(pid))) {
        return
    }

    try {
        process.kill(pid, 'SIGTERM')
    } catch (err) {
        if (isProcessGone(err)) {
            return
        }
        throw err
    }

    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
        try {
            process.kill(pid, 0)
        } catch (err) {
            if (isProcessGone(err)) {
                return
            }
            throw err
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
    }

    if (!(await hasNativeReplProcessMarker(pid))) {
        return
    }
    try {
        process.kill(pid, 0)
    } catch (err) {
        if (isProcessGone(err)) {
            return
        }
        throw err
    }
    try {
        process.kill(pid, 'SIGKILL')
    } catch (err) {
        if (isProcessGone(err)) {
            return
        }
        throw err
    }
}
