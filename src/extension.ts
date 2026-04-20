'use strict'

import * as sourcemapsupport from 'source-map-support'
import * as vscode from 'vscode'

import * as debugViewProvider from './debugger/debugConfig'
import { JuliaDebugFeature } from './debugger/debugFeature'
import * as documentation from './docbrowser/documentation'
import { CodeCellFeature } from './interactive/codecells'
import { ProfilerFeature } from './interactive/profiler'
import * as repl from './interactive/repl'
import { WorkspaceFeature } from './interactive/workspace'
import * as jlpkgenv from './jlpkgenv'
import { ExecutableFeature } from './executables'
import { LanguageClientFeature } from './languageClient'
import { JuliaNotebookFeature } from './notebook/notebookFeature'
import * as openpackagedirectory from './openpackagedirectory'
import { JuliaPackageDevFeature } from './packagedevtools'
import * as packagepath from './packagepath'
import * as smallcommands from './smallcommands'
import * as tasks from './tasks'
import * as telemetry from './telemetry'
import { TestFeature } from './testing/testFeature'
import { setContext } from './utils'
import * as weave from './weave'
import { JuliaGlobalDiagnosticOutputFeature } from './globalDiagnosticOutput'
import { JuliaCommands } from './juliaCommands'
import { installJuliaOrJuliaupTask } from './juliaupAutoInstall'
import { LmToolFeature } from './lmtool'

sourcemapsupport.install({ handleUncaughtExceptions: false })

export const increaseIndentPattern: RegExp =
    /^(\s*|.*=\s*|.*@\w*\s*)[\w\s]*(?:["'`][^"'`]*["'`])*[\w\s]*\b(if|while|for|function|macro|(mutable\s+)?struct|abstract\s+type|primitive\s+type|let|quote|try|begin|.*\)\s*do|else|elseif|catch|finally)\b(?!(?:.*\bend\b(\s*|\s*#.*)$)|(?:[^[]*\].*)$).*$/
export const decreaseIndentPattern: RegExp = /^\s*(end|else|elseif|catch|finally)\b.*$/

export async function activate(context: vscode.ExtensionContext) {
    console.debug('[julia activation] start language-julia extension')
    const activateStart = performance.now()

    telemetry.init(context)
    console.debug(`[julia activation] telemetry.init: ${(performance.now() - activateStart).toFixed(1)}ms`)

    try {
        setContext('julia.isActive', true)
        let t = performance.now()
        telemetry.traceEvent('activate')

        telemetry.startLsCrashServer()
        console.debug(`[julia activation] initial telemetry: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        const globalDiagnosticOutputFeature = new JuliaGlobalDiagnosticOutputFeature()
        context.subscriptions.push(globalDiagnosticOutputFeature)
        console.debug(`[julia activation] JuliaGlobalDiagnosticOutputFeature: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        const executableFeature = new ExecutableFeature(context)
        console.debug(`[julia activation] ExecutableFeature: ${(performance.now() - t).toFixed(1)}ms`)

        if (await executableFeature.hasJulia()) {
            executableFeature.setJuliaInstalled(true)
        }

        // Language settings
        vscode.languages.setLanguageConfiguration('julia', {
            indentationRules: {
                increaseIndentPattern: increaseIndentPattern,
                decreaseIndentPattern: decreaseIndentPattern,
            },
        })

        t = performance.now()
        const profilerFeature = new ProfilerFeature(context)
        context.subscriptions.push(profilerFeature)
        console.debug(`[julia activation] ProfilerFeature: ${(performance.now() - t).toFixed(1)}ms`)

        // Active features from other files

        t = performance.now()
        const languageClientFeature: LanguageClientFeature = new LanguageClientFeature(context, executableFeature)
        context.subscriptions.push(languageClientFeature)
        console.debug(`[julia activation] LanguageClientFeature: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        const compiledProvider = debugViewProvider.activate(context)
        console.debug(`[julia activation] debugViewProvider.activate: ${(performance.now() - t).toFixed(1)}ms`)

        context.subscriptions.push(executableFeature)

        t = performance.now()
        repl.activate(context, compiledProvider, executableFeature, profilerFeature, languageClientFeature)
        console.debug(`[julia activation] repl.activate: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        weave.activate(context, executableFeature)
        console.debug(`[julia activation] weave.activate: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        documentation.activate(context, languageClientFeature)
        console.debug(`[julia activation] documentation.activate: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        tasks.activate(context, executableFeature)
        console.debug(`[julia activation] tasks.activate: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        smallcommands.activate(context)
        console.debug(`[julia activation] smallcommands.activate: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        packagepath.activate(context, executableFeature)
        console.debug(`[julia activation] packagepath.activate: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        openpackagedirectory.activate(context)
        console.debug(`[julia activation] openpackagedirectory.activate: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        jlpkgenv.activate(context, executableFeature)
        console.debug(`[julia activation] jlpkgenv.activate: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        context.subscriptions.push(new CodeCellFeature(context, compiledProvider))
        console.debug(`[julia activation] CodeCellFeature: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        const lmToolFeature = new LmToolFeature(context)
        context.subscriptions.push(lmToolFeature)
        console.debug(`[julia activation] LmToolFeature: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        const workspaceFeature = new WorkspaceFeature(context)
        context.subscriptions.push(workspaceFeature)
        console.debug(`[julia activation] WorkspaceFeature: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        const notebookFeature = new JuliaNotebookFeature(context, executableFeature, workspaceFeature, compiledProvider)
        context.subscriptions.push(notebookFeature)
        console.debug(`[julia activation] JuliaNotebookFeature: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        context.subscriptions.push(new JuliaPackageDevFeature(context, executableFeature))
        console.debug(`[julia activation] JuliaPackageDevFeature: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        const testFeature = new TestFeature(
            context,
            executableFeature,
            workspaceFeature,
            compiledProvider,
            languageClientFeature
        )
        await testFeature.init()
        context.subscriptions.push(testFeature)
        console.debug(`[julia activation] TestFeature: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        context.subscriptions.push(new JuliaDebugFeature(context, compiledProvider, executableFeature, notebookFeature))
        console.debug(`[julia activation] JuliaDebugFeature: ${(performance.now() - t).toFixed(1)}ms`)

        t = performance.now()
        context.subscriptions.push(new JuliaCommands(context, executableFeature))
        console.debug(`[julia activation] JuliaCommands: ${(performance.now() - t).toFixed(1)}ms`)

        if (vscode.workspace.getConfiguration('julia').get<boolean>('symbolCacheDownload') === null) {
            vscode.window
                .showInformationMessage(
                    'The extension will download symbol server cache files from GitHub, if possible. You can disable this behaviour in the settings.',
                    'Open Settings'
                )
                .then((val) => {
                    if (val) {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'julia.symbolCacheDownload')
                    }
                })
            vscode.workspace
                .getConfiguration('julia')
                .update('symbolCacheDownload', true, vscode.ConfigurationTarget.Global)
        }

        t = performance.now()
        languageClientFeature.startServer()
        console.debug(`[julia activation] languageClientFeature.startServer: ${(performance.now() - t).toFixed(1)}ms`)

        if (vscode.workspace.getConfiguration('julia').get<boolean>('enableTelemetry') === null) {
            const agree = 'Yes'
            const disagree = 'No'
            vscode.window
                .showInformationMessage(
                    'To help improve the Julia extension, you can allow the development team to collect usage data. Read our [privacy statement](https://github.com/julia-vscode/julia-vscode/wiki/Privacy-Policy) to learn more about how we use usage data. Do you agree to usage data collection?',
                    agree,
                    disagree
                )
                .then((choice) => {
                    if (choice === agree) {
                        vscode.workspace
                            .getConfiguration('julia')
                            .update('enableTelemetry', true, vscode.ConfigurationTarget.Global)
                    } else if (choice === disagree) {
                        vscode.workspace
                            .getConfiguration('julia')
                            .update('enableTelemetry', false, vscode.ConfigurationTarget.Global)
                    }
                })
        }

        const api = {
            version: 6,
            async getEnvironment() {
                return await jlpkgenv.getAbsEnvPath()
            },
            async getJuliaupExecutable(tryInstall: boolean = true) {
                return await executableFeature.getJuliaupExecutable(tryInstall)
            },
            async getJuliaExecutable(tryInstall: boolean = true) {
                return await executableFeature.getExecutable(tryInstall)
            },
            async getJuliaPath() {
                console.warn('Julia extension for VSCode: `getJuliaPath` API is deprecated.')
                return (await executableFeature.getExecutable()).command
            },
            getPkgServer() {
                return vscode.workspace.getConfiguration('julia').get('packageServer')
            },
            async installJuliaOrJuliaup(customCommand?: string) {
                return await installJuliaOrJuliaupTask(executableFeature.taskRunner, customCommand)
            },
            executeInREPL: repl.executeInREPL,
        }

        console.debug(`[julia activation] total: ${(performance.now() - activateStart).toFixed(1)}ms`)

        return api
    } catch (err) {
        telemetry.handleNewCrashReportFromException(err, 'Extension')
        throw err
    }
}

// this method is called when your extension is deactivated
export function deactivate() {
    const promises = []

    promises.push(repl.deactivate())

    telemetry.flush()

    return Promise.all(promises)
}
