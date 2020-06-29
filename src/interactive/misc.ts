import * as vscode from 'vscode'
import * as vslc from 'vscode-languageclient'

export interface VersionedTextDocumentPositionParams {
    textDocument: vslc.TextDocumentIdentifier,
    version: number,
    position: vscode.Position
}
