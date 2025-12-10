'use strict'

import * as sourcemapsupport from 'source-map-support'
import * as vscode from 'vscode'

import * as debugViewProvider from './debugger/debugConfig'
import { JuliaDebugFeature } from './debugger/debugFeature'
import * as documentation from './docbrowser/documentation'
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

sourcemapsupport.install({ handleUncaughtExceptions: false })

export const increaseIndentPattern: RegExp =
    /^(\s*|.*=\s*|.*@\w*\s*)[\w\s]*(?:["'`][^"'`]*["'`])*[\w\s]*\b(if|while|for|function|macro|(mutable\s+)?struct|abstract\s+type|primitive\s+type|let|quote|try|begin|.*\)\s*do|else|elseif|catch|finally)\b(?!(?:.*\bend\b(\s*|\s*#.*)$)|(?:[^[]*\].*)$).*$/
export const decreaseIndentPattern: RegExp = /^\s*(end|else|elseif|catch|finally)\b.*$/

export async function activate(context: vscode.ExtensionContext) {
    await telemetry.init(context)
    try {
        setContext('julia.isActive', true)

        telemetry.traceEvent('activate')

        telemetry.startLsCrashServer()

        const globalDiagnosticOutputFeature = new JuliaGlobalDiagnosticOutputFeature()
        context.subscriptions.push(globalDiagnosticOutputFeature)

        console.debug('Activating extension language-julia')

        const executableFeature = new ExecutableFeature(context)

        // Language settings
        vscode.languages.setLanguageConfiguration('julia', {
            indentationRules: {
                increaseIndentPattern: increaseIndentPattern,
                decreaseIndentPattern: decreaseIndentPattern,
            },
        })

        const profilerFeature = new ProfilerFeature(context)
        context.subscriptions.push(profilerFeature)

        // Active features from other files

        const languageClientFeature: LanguageClientFeature = new LanguageClientFeature(context, executableFeature)
        context.subscriptions.push(languageClientFeature)

        const compiledProvider = debugViewProvider.activate(context)
        context.subscriptions.push(executableFeature)

        repl.activate(context, compiledProvider, executableFeature, profilerFeature, languageClientFeature)
        weave.activate(context, executableFeature)
        documentation.activate(context, languageClientFeature)
        tasks.activate(context, executableFeature)
        smallcommands.activate(context)
        packagepath.activate(context, executableFeature)
        openpackagedirectory.activate(context)
        jlpkgenv.activate(context, executableFeature, languageClientFeature)

        const workspaceFeature = new WorkspaceFeature(context)
        context.subscriptions.push(workspaceFeature)
        const notebookFeature = new JuliaNotebookFeature(context, executableFeature, workspaceFeature, compiledProvider)
        context.subscriptions.push(notebookFeature)
        context.subscriptions.push(new JuliaPackageDevFeature(context, executableFeature))

        const testFeature = new TestFeature(
            context,
            executableFeature,
            workspaceFeature,
            compiledProvider,
            languageClientFeature
        )
        context.subscriptions.push(testFeature)

        context.subscriptions.push(new JuliaDebugFeature(context, compiledProvider, executableFeature, notebookFeature))

        context.subscriptions.push(new JuliaCommands(context, executableFeature))

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

        languageClientFeature.startServer()

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
            version: 5,
            async getEnvironment() {
                return await jlpkgenv.getAbsEnvPath()
            },
            async getJuliaupExecutable() {
                return await executableFeature.getJuliaupExecutable()
            },
            async getJuliaExecutable() {
                return await executableFeature.getExecutable()
            },
            async getJuliaPath() {
                console.warn('Julia extension for VSCode: `getJuliaPath` API is deprecated.')
                return (await executableFeature.getExecutable()).command
            },
            getPkgServer() {
                return vscode.workspace.getConfiguration('julia').get('packageServer')
            },
            async installJuliaOrJuliaup(taskName: string, customCommand?: string) {
                return await installJuliaOrJuliaupTask(taskName, customCommand)
            },
            executeInREPL: repl.executeInREPL,
        }

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
