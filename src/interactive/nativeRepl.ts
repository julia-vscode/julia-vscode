import { randomBytes, randomUUID } from 'crypto'
import * as fs from 'node:fs/promises'
import * as net from 'net'
import { tmpdir } from 'os'
import * as path from 'path'

export interface NativeReplSession {
    id: string
    token: string
    directory: string
    controlPipe: string
    generation: number
    terminalPid?: number
    juliaPid?: number
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
    endpoints: { pipe?: string; debugPipe?: string } = {},
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
                    finish(result.ok === true ? undefined : new Error('Julia rejected the reconnect request.'))
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
