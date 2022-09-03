import * as vscode from 'vscode'

export class JuliaGlobalDiagnosticOutputFeature {
    outputChannel: vscode.OutputChannel

    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Julia')
    }

    public dispose() {
    }

    public append(msg: string) {
        this.outputChannel.append(msg)
    }

    public appendLine(msg: string) {
        this.outputChannel.appendLine(msg)
    }
}
