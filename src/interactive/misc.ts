import * as vscode from 'vscode';
import * as vslc from 'vscode-languageclient';

export interface TextDocumentPositionParams {
    textDocument: vslc.TextDocumentIdentifier
    position: vscode.Position
}
