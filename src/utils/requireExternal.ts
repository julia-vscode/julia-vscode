// Slightly modified version of
// https://github.com/swiftlang/vscode-swift/blob/a19d0b1bfe2d7a1740f8cf94c6503f584e34c71b/src/utilities/native.ts

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
/* eslint-disable @typescript-eslint/no-require-imports */
import * as vscode from 'vscode'
import * as path from 'path'

// To not electron-rebuild for every platform and arch, we want to
// use the asar bundled native module. Taking inspiration from
// https://github.com/microsoft/node-pty/issues/582
export function requireNativeModule<T>(id: string): T {
    if (vscode.env.remoteName) {
        return require(path.join(vscode.env.appRoot, 'node_modules', id))
    }
    // https://github.com/microsoft/vscode/commit/a162831c17ad0d675f1f0d5c3f374fd1514f04b5
    // VSCode has moved node-pty out of asar bundle
    try {
        return require(path.join(vscode.env.appRoot, 'node_modules.asar', id))
    } catch {
        return require(path.join(vscode.env.appRoot, 'node_modules', id))
    }
}
