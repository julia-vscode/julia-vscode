import * as fs from 'async-file'
import { ChildProcess, spawn } from 'child_process'
import * as path from 'path'
import * as vscode from 'vscode'
import * as jlpkgenv from './jlpkgenv'
import { ExecutableFeature } from './executables'
import { getCustomEnvironmentVariables, registerCommand } from './utils'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assert } from 'node:console'

export class WeaveFeature {
    private g_lastWeaveContent?: string = undefined
    private g_weaveOutputChannel?: vscode.OutputChannel = undefined
    private g_weaveChildProcess?: ChildProcess = undefined
    private g_weaveNextChildProcess?: ChildProcess = undefined

    constructor(
        private context: vscode.ExtensionContext,
        private executableFeature: ExecutableFeature
    ) {
        context.subscriptions.push(registerCommand('language-julia.weave-open-preview', this.open_preview.bind(this)))
        context.subscriptions.push(
            registerCommand('language-julia.weave-open-preview-side', this.open_preview_side.bind(this))
        )
        context.subscriptions.push(registerCommand('language-julia.weave-save', this.save.bind(this)))
    }

    private async weave_core(column: number, activeTextEditor: vscode.TextEditor, selected_format?: string) {
        assert(vscode.window.activeTextEditor !== undefined)

        let source_filename: string
        let output_filename: string
        if (selected_format === undefined) {
            const temporary_dirname = await mkdtemp(join(tmpdir(), 'julia-vscode-weave-'))

            source_filename = path.join(temporary_dirname, 'source-file.jmd')

            const source_text = activeTextEditor.document.getText()

            await fs.writeTextFile(source_filename, source_text, 'utf8')

            // note that there is a bug in Weave.jl right now that does not support the option
            // out_path properly. The output file will therefore always have the format [input-file].html
            output_filename = path.join(temporary_dirname, 'source-file.html')
        } else {
            source_filename = activeTextEditor.document.fileName
            output_filename = ''
        }

        if (this.g_weaveOutputChannel === undefined) {
            this.g_weaveOutputChannel = vscode.window.createOutputChannel('Julia Weave')
        }
        this.g_weaveOutputChannel.clear()
        this.g_weaveOutputChannel.show(true)

        const outputChannel = this.g_weaveOutputChannel

        if (this.g_weaveChildProcess !== undefined) {
            try {
                this.g_weaveChildProcess.kill()
            } catch (e) {
                console.log(e)
            }
        }

        const juliaExecutable = await this.executableFeature.getExecutable()
        const pkgenvpath = await jlpkgenv.getAbsEnvPath()

        const args = [path.join(this.context.extensionPath, 'scripts', 'weave', 'run_weave.jl')]

        if (pkgenvpath) {
            args.unshift(`--project=${pkgenvpath}`)
        }

        console.log(args)

        if (this.g_weaveNextChildProcess === undefined) {
            this.g_weaveNextChildProcess = spawn(juliaExecutable.command, [...juliaExecutable.args, ...args], {
                env: { ...process.env, ...getCustomEnvironmentVariables() },
            })

            this.g_weaveNextChildProcess.on('error', (err) => {
                outputChannel.append(String('Failed to start weave process: ' + err + '\n'))
            })
        }
        this.g_weaveChildProcess = this.g_weaveNextChildProcess

        if (
            this.g_weaveChildProcess.stdin === null ||
            this.g_weaveChildProcess.stdout === null ||
            this.g_weaveChildProcess.stderr === null
        ) {
            throw new Error('Weave process stdin, stdout, or stderr is null')
        }

        this.g_weaveChildProcess.stdin.write(source_filename + '\n')
        this.g_weaveChildProcess.stdin.write(output_filename + '\n')
        if (selected_format === undefined) {
            this.g_weaveChildProcess.stdin.write('PREVIEW\n')
            this.g_weaveOutputChannel.append(String('Weaving preview of ' + source_filename + '\n'))
        } else {
            this.g_weaveChildProcess.stdin.write(selected_format + '\n')
            this.g_weaveOutputChannel.append(String('Weaving ' + source_filename + ' to ' + output_filename + '\n'))
        }

        this.g_weaveNextChildProcess = spawn(juliaExecutable.command, [...juliaExecutable.args, ...args], {
            env: { ...process.env, ...getCustomEnvironmentVariables() },
        })
        this.g_weaveNextChildProcess.on('error', (err) => {
            outputChannel.append(String('Failed to start weave process: ' + err + '\n'))
        })

        this.g_weaveChildProcess.stdout.on('data', (data) => {
            outputChannel.append(String(data))
        })
        this.g_weaveChildProcess.stderr.on('data', (data) => {
            outputChannel.append(String(data))
        })
        this.g_weaveChildProcess.on('close', async (code) => {
            this.g_weaveChildProcess = undefined

            if (code === 0) {
                outputChannel.hide()

                if (selected_format === undefined) {
                    this.g_lastWeaveContent = await fs.readFile(output_filename, 'utf8')

                    const weaveWebViewPanel = vscode.window.createWebviewPanel('jlweavepane', 'Julia Weave Preview', {
                        preserveFocus: true,
                        viewColumn: column,
                    })

                    weaveWebViewPanel.webview.html = this.g_lastWeaveContent ?? ''
                }
            } else {
                vscode.window.showErrorMessage('Error during weaving.')
            }
        })
    }

    private async open_preview() {
        if (vscode.window.activeTextEditor === undefined) {
            vscode.window.showErrorMessage('Please open a document before you execute the weave command.')
        } else if (vscode.window.activeTextEditor.document.languageId !== 'juliamarkdown') {
            vscode.window.showErrorMessage('Only julia Markdown (.jmd) files can be weaved.')
        } else {
            await this.weave_core(vscode.ViewColumn.Active, vscode.window.activeTextEditor)
        }
    }

    private async open_preview_side() {
        if (vscode.window.activeTextEditor === undefined) {
            vscode.window.showErrorMessage('Please open a document before you execute the weave command.')
        } else if (vscode.window.activeTextEditor.document.languageId !== 'juliamarkdown') {
            vscode.window.showErrorMessage('Only julia Markdown (.jmd) files can be weaved.')
        } else {
            this.weave_core(vscode.ViewColumn.Two, vscode.window.activeTextEditor)
        }
    }

    private async save() {
        if (vscode.window.activeTextEditor === undefined) {
            vscode.window.showErrorMessage('Please open a document before you execute the weave command.')
        } else if (vscode.window.activeTextEditor.document.languageId !== 'juliamarkdown') {
            vscode.window.showErrorMessage('Only julia Markdown (.jmd) files can be weaved.')
        } else if (
            vscode.window.activeTextEditor.document.isDirty ||
            vscode.window.activeTextEditor.document.isUntitled
        ) {
            vscode.window.showErrorMessage('Please save the file before weaving.')
        } else {
            const formats = [
                'github: Github markdown',
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
                'asciidoc: AsciiDoc',
            ]
            const result_format = await vscode.window.showQuickPick(formats, { placeHolder: 'Select output format' })
            if (result_format !== undefined) {
                const index = result_format.indexOf(':')
                const selected_format = result_format.substring(0, index)
                this.weave_core(vscode.ViewColumn.One, vscode.window.activeTextEditor, selected_format)
            }
        }
    }

    public dispose() {}
}
