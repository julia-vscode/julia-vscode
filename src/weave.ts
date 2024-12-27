import * as fs from 'async-file'
import { ChildProcess, spawn } from 'child_process'
import * as path from 'path'
import * as vscode from 'vscode'
import * as jlpkgenv from './jlpkgenv'
import { JuliaExecutablesFeature } from './juliaexepath'
import * as telemetry from './telemetry'
import { registerCommand } from './utils'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

let g_context: vscode.ExtensionContext = null

let g_lastWeaveContent: string = null
let g_weaveOutputChannel: vscode.OutputChannel = null
let g_weaveChildProcess: ChildProcess = null
let g_weaveNextChildProcess: ChildProcess = null

let g_juliaExecutablesFeature: JuliaExecutablesFeature

async function weave_core(column, selected_format: string = undefined) {
    let source_filename: string
    let output_filename: string
    if (selected_format === undefined) {
        const temporary_dirname = await mkdtemp(join(tmpdir(), 'julia-vscode-weave-'))

        source_filename = path.join(temporary_dirname, 'source-file.jmd')

        const source_text = vscode.window.activeTextEditor.document.getText()

        await fs.writeTextFile(source_filename, source_text, 'utf8')

        // note that there is a bug in Weave.jl right now that does not support the option
        // out_path properly. The output file will therefore always have the format [input-file].html
        output_filename = path.join(temporary_dirname, 'source-file.html')
    }
    else {
        source_filename = vscode.window.activeTextEditor.document.fileName
        output_filename = ''
    }

    if (g_weaveOutputChannel === null) {
        g_weaveOutputChannel = vscode.window.createOutputChannel('Julia Weave')
    }
    g_weaveOutputChannel.clear()
    g_weaveOutputChannel.show(true)

    if (g_weaveChildProcess !== null) {
        try {
            g_weaveChildProcess.kill()
        }
        catch (e) {
        }
    }

    const juliaExecutable = await g_juliaExecutablesFeature.getActiveJuliaExecutableAsync()
    const pkgenvpath = await jlpkgenv.getAbsEnvPath()

    const args = [path.join(g_context.extensionPath, 'scripts', 'weave', 'run_weave.jl')]

    if (pkgenvpath) {
        args.unshift(`--project=${pkgenvpath}`)
    }

    console.log(args)

    if (g_weaveNextChildProcess === null) {
        g_weaveNextChildProcess = spawn(juliaExecutable.file, [...juliaExecutable.args, ...args])
    }
    g_weaveChildProcess = g_weaveNextChildProcess

    g_weaveChildProcess.stdin.write(source_filename + '\n')
    g_weaveChildProcess.stdin.write(output_filename + '\n')
    if (selected_format === undefined) {
        g_weaveChildProcess.stdin.write('PREVIEW\n')
        g_weaveOutputChannel.append(String('Weaving preview of ' + source_filename + '\n'))
    }
    else {
        g_weaveChildProcess.stdin.write(selected_format + '\n')
        g_weaveOutputChannel.append(String('Weaving ' + source_filename + ' to ' + output_filename + '\n'))
    }

    g_weaveNextChildProcess = spawn(juliaExecutable.file, [...juliaExecutable.args, ...args])

    g_weaveChildProcess.stdout.on('data', function (data) {
        g_weaveOutputChannel.append(String(data))
    })
    g_weaveChildProcess.stderr.on('data', function (data) {
        g_weaveOutputChannel.append(String(data))
    })
    g_weaveChildProcess.on('close', async function (code) {
        g_weaveChildProcess = null

        if (code === 0) {
            g_weaveOutputChannel.hide()

            if (selected_format === undefined) {
                g_lastWeaveContent = await fs.readFile(output_filename, 'utf8')

                const weaveWebViewPanel = vscode.window.createWebviewPanel('jlweavepane', 'Julia Weave Preview', { preserveFocus: true, viewColumn: column })

                weaveWebViewPanel.webview.html = g_lastWeaveContent
            }
        }
        else {
            vscode.window.showErrorMessage('Error during weaving.')
        }

    })
}

async function open_preview() {
    telemetry.traceEvent('command-weaveopenpreview')

    if (vscode.window.activeTextEditor === undefined) {
        vscode.window.showErrorMessage('Please open a document before you execute the weave command.')
    }
    else if (vscode.window.activeTextEditor.document.languageId !== 'juliamarkdown') {
        vscode.window.showErrorMessage('Only julia Markdown (.jmd) files can be weaved.')
    }
    else {
        await weave_core(vscode.ViewColumn.Active)
    }
}

async function open_preview_side() {
    telemetry.traceEvent('command-weaveopenpreviewside')

    if (vscode.window.activeTextEditor === undefined) {
        vscode.window.showErrorMessage('Please open a document before you execute the weave command.')
    }
    else if (vscode.window.activeTextEditor.document.languageId !== 'juliamarkdown') {
        vscode.window.showErrorMessage('Only julia Markdown (.jmd) files can be weaved.')
    }
    else {
        weave_core(vscode.ViewColumn.Two)
    }
}

async function save() {
    telemetry.traceEvent('command-weavesave')

    if (vscode.window.activeTextEditor === undefined) {
        vscode.window.showErrorMessage('Please open a document before you execute the weave command.')
    }
    else if (vscode.window.activeTextEditor.document.languageId !== 'juliamarkdown') {
        vscode.window.showErrorMessage('Only julia Markdown (.jmd) files can be weaved.')
    }
    else if (vscode.window.activeTextEditor.document.isDirty || vscode.window.activeTextEditor.document.isUntitled) {
        vscode.window.showErrorMessage('Please save the file before weaving.')
    }
    else {
        const formats = ['github: Github markdown',
            'md2tex: Julia markdown to latex',
            'pandoc2html: Markdown to HTML (requires Pandoc)',
            'pandoc: Pandoc markdown',
            'pandoc2pdf: Pandoc markdown',
            'tex: Latex with custom code environments',
            'texminted: Latex using minted for highlighting',
            'md2html: Julia markdown to html',
            'rst: reStructuredText and Sphinx',
            'multimarkdown: MultiMarkdown',
            'md2pdf: Julia markdown to latex',
            'asciidoc: AsciiDoc']
        const result_format = await vscode.window.showQuickPick(formats, { placeHolder: 'Select output format' })
        if (result_format !== undefined) {
            const index = result_format.indexOf(':')
            const selected_format = result_format.substring(0, index)
            weave_core(vscode.ViewColumn.One, selected_format)
        }
    }
}

export function activate(context: vscode.ExtensionContext, juliaExecutablesFeature: JuliaExecutablesFeature) {
    g_context = context
    g_juliaExecutablesFeature = juliaExecutablesFeature

    context.subscriptions.push(registerCommand('language-julia.weave-open-preview', open_preview))
    context.subscriptions.push(registerCommand('language-julia.weave-open-preview-side', open_preview_side))
    context.subscriptions.push(registerCommand('language-julia.weave-save', save))
}
