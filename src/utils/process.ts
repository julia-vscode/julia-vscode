// Heavily modified version of
// https://github.com/swiftlang/vscode-swift/blob/a19d0b1bfe2d7a1740f8cf94c6503f584e34c71b/src/tasks/SwiftProcess.ts

//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) 2024 the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from 'vscode'
import { requireNativeModule } from './requireExternal'
import type * as nodePty from 'node-pty'

const { spawn } = requireNativeModule<typeof nodePty>('node-pty')

export interface ProcessExit {
    exitCode: number | void
    output?: string
}

interface ExecutionOptions extends vscode.ProcessExecutionOptions {
    collectOutput?: boolean
}

class CloseHandler implements vscode.Disposable {
    private readonly closeEmitter: vscode.EventEmitter<ProcessExit | void> =
        new vscode.EventEmitter<ProcessExit | void>()
    private processExit: ProcessExit
    private closeTimeout: NodeJS.Timeout | undefined

    event = this.closeEmitter.event

    handle(ex: ProcessExit) {
        this.processExit = ex
        this.queueClose()
    }

    reset() {
        if (this.closeTimeout) {
            clearTimeout(this.closeTimeout)
            this.queueClose()
        }
    }

    dispose() {
        this.closeEmitter.dispose()
    }

    private queueClose() {
        this.closeTimeout = setTimeout(() => {
            this.closeEmitter.fire(this.processExit)
        }, 250)
    }
}

export class JuliaProcess implements vscode.Disposable {
    private readonly spawnEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>()
    private readonly writeEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter<string>()
    private readonly errorEmitter: vscode.EventEmitter<Error> = new vscode.EventEmitter<Error>()
    private readonly closeHandler: CloseHandler = new CloseHandler()
    private disposables: vscode.Disposable[] = []

    private output: string
    private collectOutput = false

    private pty?: nodePty.IPty

    constructor(
        public readonly command: string,
        public readonly args: string[],
        private options: ExecutionOptions = {}
    ) {
        this.disposables.push(this.spawnEmitter, this.writeEmitter, this.errorEmitter, this.closeHandler)
        if (options.collectOutput) {
            this.collectOutput = true
        }
    }

    spawn(): void {
        try {
            const isWindows = process.platform === 'win32'
            // The pty process hangs on Windows when debugging the extension if we use conpty
            // See https://github.com/microsoft/node-pty/issues/640
            // const useConpty = isWindows && process.env['DEBUG_MODE'] === 'true' ? false : true

            // disable conpty, since it causes rendering issues in the REPL
            const useConpty = false

            this.pty = spawn(this.command, this.args, {
                cwd: this.options.cwd,
                env: { ...process.env, ...this.options.env },
                useConpty,
                // https://github.com/swiftlang/vscode-swift/issues/1074
                // Causing weird truncation issues
                cols: isWindows ? 4096 : undefined,
            })
            this.spawnEmitter.fire()

            if (this.collectOutput) {
                this.output = ''
            }
            this.pty.onData((data) => {
                this.writeEmitter.fire(data)
                if (this.collectOutput) {
                    this.output += data
                }
                this.closeHandler.reset()
            })
            this.pty.onExit((event) => {
                if (event.signal) {
                    this.closeHandler.handle({
                        exitCode: event.signal,
                        output: this.output,
                    })
                } else if (typeof event.exitCode === 'number') {
                    this.closeHandler.handle({
                        exitCode: event.exitCode,
                        output: this.output,
                    })
                } else {
                    this.closeHandler.handle({
                        exitCode: null,
                        output: this.output,
                    })
                }
            })
            this.disposables.push(
                this.onDidClose(() => {
                    this.dispose()
                })
            )
        } catch (error) {
            this.errorEmitter.fire(new Error(`${error}`))
            this.closeHandler.handle({
                exitCode: null,
                output: this.output,
            })
        }
    }

    handleInput(s: string): void {
        this.pty?.write(s)
    }

    terminate(signal?: NodeJS.Signals): void {
        if (!this.pty) {
            return
        }
        this.pty.kill(signal)
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        // https://github.com/swiftlang/vscode-swift/issues/1074
        // Causing weird truncation issues
        if (process.platform === 'win32') {
            return
        }
        this.pty?.resize(dimensions.columns, dimensions.rows)
    }

    dispose() {
        this.disposables.forEach((d) => d.dispose())
    }

    onDidSpawn: vscode.Event<void> = this.spawnEmitter.event

    onDidWrite: vscode.Event<string> = this.writeEmitter.event

    onDidThrowError: vscode.Event<Error> = this.errorEmitter.event

    onDidClose: vscode.Event<ProcessExit> = this.closeHandler.event
}
