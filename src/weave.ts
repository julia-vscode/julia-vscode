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
    private lastWeaveContent?: string = undefined
    private weaveOutputChannel?: vscode.OutputChannel = undefined
    private weaveChildProcess?: ChildProcess = undefined
    private weaveNextChildProcess?: ChildProcess = undefined

    constructor(
        private context: vscode.ExtensionContext,
        private executableFeature: ExecutableFeature
    ) {
        context.subscriptions.push(registerCommand('language-julia.weave-open-preview', this.openPreview.bind(this)))
        context.subscriptions.push(
            registerCommand('language-julia.weave-open-preview-side', this.openPreviewSide.bind(this))
        )
        context.subscriptions.push(registerCommand('language-julia.weave-save', this.save.bind(this)))
    }

    private async runWeave(column: number, activeTextEditor: vscode.TextEditor, selectedFormat?: string) {
        assert(vscode.window.activeTextEditor !== undefined)

        let sourceFilename: string
        let outputFilename: string
        if (selectedFormat === undefined) {
            const temporaryDirname = await mkdtemp(join(tmpdir(), 'julia-vscode-weave-'))

            sourceFilename = path.join(temporaryDirname, 'source-file.jmd')

            const sourceText = activeTextEditor.document.getText()

            await fs.writeTextFile(sourceFilename, sourceText, 'utf8')

            // note that there is a bug in Weave.jl right now that does not support the option
            // out_path properly. The output file will therefore always have the format [input-file].html
            outputFilename = path.join(temporaryDirname, 'source-file.html')
        } else {
            sourceFilename = activeTextEditor.document.fileName
            outputFilename = ''
        }

        if (this.weaveOutputChannel === undefined) {
            this.weaveOutputChannel = vscode.window.createOutputChannel('Julia Weave')
        }
        this.weaveOutputChannel.clear()
        this.weaveOutputChannel.show(true)

        const outputChannel = this.weaveOutputChannel

        if (this.weaveChildProcess !== undefined) {
            try {
                this.weaveChildProcess.kill()
            } catch (e) {
                console.log(e)
            }
        }

        const juliaExecutable = await this.executableFeature.getExecutable()
        const pkgEnvPath = await jlpkgenv.getAbsEnvPath()

        const args = [path.join(this.context.extensionPath, 'scripts', 'weave', 'run_weave.jl')]

        if (pkgEnvPath) {
            args.unshift(`--project=${pkgEnvPath}`)
        }

        console.log(args)

        if (this.weaveNextChildProcess === undefined) {
            this.weaveNextChildProcess = spawn(juliaExecutable.command, [...juliaExecutable.args, ...args], {
                env: { ...process.env, ...getCustomEnvironmentVariables() },
            })

            this.weaveNextChildProcess.on('error', (err) => {
                outputChannel.append(String('Failed to start weave process: ' + err + '\n'))
            })
        }
        this.weaveChildProcess = this.weaveNextChildProcess

        if (
            this.weaveChildProcess.stdin === null ||
            this.weaveChildProcess.stdout === null ||
            this.weaveChildProcess.stderr === null
        ) {
            throw new Error('Weave process stdin, stdout, or stderr is null')
        }

        this.weaveChildProcess.stdin.write(sourceFilename + '\n')
        this.weaveChildProcess.stdin.write(outputFilename + '\n')
        if (selectedFormat === undefined) {
            this.weaveChildProcess.stdin.write('PREVIEW\n')
            this.weaveOutputChannel.append(String('Weaving preview of ' + sourceFilename + '\n'))
        } else {
            this.weaveChildProcess.stdin.write(selectedFormat + '\n')
            this.weaveOutputChannel.append(String('Weaving ' + sourceFilename + ' to ' + outputFilename + '\n'))
        }

        this.weaveNextChildProcess = spawn(juliaExecutable.command, [...juliaExecutable.args, ...args], {
            env: { ...process.env, ...getCustomEnvironmentVariables() },
        })
        this.weaveNextChildProcess.on('error', (err) => {
            outputChannel.append(String('Failed to start weave process: ' + err + '\n'))
        })

        this.weaveChildProcess.stdout.on('data', (data) => {
            outputChannel.append(String(data))
        })
        this.weaveChildProcess.stderr.on('data', (data) => {
            outputChannel.append(String(data))
        })
        this.weaveChildProcess.on('close', async (code) => {
            this.weaveChildProcess = undefined

            if (code === 0) {
                outputChannel.hide()

                if (selectedFormat === undefined) {
                    this.lastWeaveContent = await fs.readFile(outputFilename, 'utf8')

                    const weaveWebViewPanel = vscode.window.createWebviewPanel('jlweavepane', 'Julia Weave Preview', {
                        preserveFocus: true,
                        viewColumn: column,
                    })

                    weaveWebViewPanel.webview.html = this.lastWeaveContent ?? ''
                }
            } else {
                vscode.window.showErrorMessage('Error during weaving.')
            }
        })
    }

    private async openPreview() {
        if (vscode.window.activeTextEditor === undefined) {
            vscode.window.showErrorMessage('Please open a document before you execute the weave command.')
        } else if (vscode.window.activeTextEditor.document.languageId !== 'juliamarkdown') {
            vscode.window.showErrorMessage('Only julia Markdown (.jmd) files can be weaved.')
        } else {
            await this.runWeave(vscode.ViewColumn.Active, vscode.window.activeTextEditor)
        }
    }

    private async openPreviewSide() {
        if (vscode.window.activeTextEditor === undefined) {
            vscode.window.showErrorMessage('Please open a document before you execute the weave command.')
        } else if (vscode.window.activeTextEditor.document.languageId !== 'juliamarkdown') {
            vscode.window.showErrorMessage('Only julia Markdown (.jmd) files can be weaved.')
        } else {
            this.runWeave(vscode.ViewColumn.Two, vscode.window.activeTextEditor)
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
            const resultFormat = await vscode.window.showQuickPick(formats, { placeHolder: 'Select output format' })
            if (resultFormat !== undefined) {
                const index = resultFormat.indexOf(':')
                const selectedFormat = resultFormat.substring(0, index)
                this.runWeave(vscode.ViewColumn.One, vscode.window.activeTextEditor, selectedFormat)
            }
        }
    }

    public dispose() {}
}
