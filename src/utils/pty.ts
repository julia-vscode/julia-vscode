// Heavily modified version of
// https://github.com/swiftlang/vscode-swift/blob/a19d0b1bfe2d7a1740f8cf94c6503f584e34c71b/src/tasks/SwiftPseudoterminal.ts

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
import type { JuliaProcess } from './process'

export interface JuliaPTYOptions {
    echoCommand?: boolean
    onExitMessage?: (exitCode: number | void) => string | undefined
    showDefaultErrorMessage?: boolean
}

export class JuliaPTY implements vscode.Pseudoterminal, vscode.Disposable {
    private writeEmitter: vscode.EventEmitter<string> = new vscode.EventEmitter()
    onDidWrite: vscode.Event<string> = this.writeEmitter.event

    private closeEmitter: vscode.EventEmitter<number | void> = new vscode.EventEmitter()
    onDidClose?: vscode.Event<number | void> = this.closeEmitter.event

    private disposables: vscode.Disposable[] = []

    private isClosed: boolean = false
    private exitCode: number | void

    constructor(
        private proc: JuliaProcess,
        private options: JuliaPTYOptions
    ) {}

    open(initialDimensions?: vscode.TerminalDimensions): void {
        this.disposables.push(
            this.proc.onDidSpawn(() => {
                if (this.options.echoCommand !== false) {
                    const exec = [this.proc.command, ...this.proc.args].join(' ')
                    this.write(`\x1b[30;47m * \x1b[0m Executing ${exec}\n\n\r`)
                }
            }),
            this.proc.onDidWrite((data) => {
                this.write(data.replace(/\n(\r)?/g, '\n\r'))
            }),
            this.proc.onDidThrowError((err) => {
                vscode.window.showErrorMessage(`Process failed: ${err}`)

                this.closeEmitter.fire()
                this.dispose()
            }),
            this.proc.onDidClose((ev) => {
                const msg = this.options?.onExitMessage?.(ev)

                if (msg) {
                    this.isClosed = true
                    this.exitCode = ev
                    this.write(msg)
                } else {
                    // we probably want to hide the vscode-native error pop-up by default
                    this.closeEmitter.fire(this.options?.showDefaultErrorMessage ? ev : undefined)
                    this.dispose()
                }
            })
        )

        this.proc.spawn()

        if (initialDimensions) {
            this.setDimensions(initialDimensions)
        }
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        this.proc?.setDimensions(dimensions)
    }

    write(data: string) {
        this.writeEmitter.fire(data)
    }

    close(): void {
        this.proc.terminate()
        this.writeEmitter.dispose()
        this.closeEmitter.dispose()
    }

    handleInput(data: string): void {
        this.proc?.handleInput(data)

        if (this.isClosed) {
            this.closeEmitter.fire(this.options?.showDefaultErrorMessage ? this.exitCode : undefined)
            this.dispose()
        }
    }

    dispose() {
        for (const disposable of this.disposables) {
            disposable.dispose()
        }
    }
}
