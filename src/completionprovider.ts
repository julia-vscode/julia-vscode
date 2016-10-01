'use strict';

import * as vscode from 'vscode';
import * as net from 'net';
import * as path from 'path';
import * as cp from 'child_process';

var cmdId: number = 0;
var commands = new Map<number, ICommand>();
var commandQueue: number[] = [];
var proc: cp.ChildProcess;
var juliaPath = 'julia';
var juliaProcessCWD = '';
var previousData = '';
var client: net.Socket;

export class JuliaCompletionItemProvider implements vscode.CompletionItemProvider {

    public constructor(context: vscode.ExtensionContext) {
        killProcess();
        initialize(context.asAbsolutePath("."));
    }

    public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Thenable<vscode.CompletionItem[]> {
        return new Promise<vscode.CompletionItem[]>((resolve, reject) => {
            if (!proc) {
                return reject("Julia proc is not initialized");
            }

            let filename = document.fileName;
            let line = document.lineAt(position.line).text;

            if (line.match(/^\s*\/\//)) {
                return resolve([]);
            }

            let wordAtposition = document.getWordRangeAtPosition(position);
            let currentWord = "";
            if (wordAtposition && wordAtposition.start.character < position.character) {
                let word = document.getText(wordAtposition);
                currentWord = word.substr(0, position.character - wordAtposition.start.character);
            }

            if (currentWord.match(/^\d+$/)) {
                return resolve([]);
            }
            let request: IRequest = {
                id: getNextCommandId(),
                requestType: "completion",
                source: line,
                fileName: filename,
                lineIndex: position.line,
                columnIndex: position.character
            };
            let cmd: ICommand = {
                id: request.id,
                commandType: request.requestType,
                resolve: resolve,
                reject: reject,
                token: token
            };
            try {
                proc.stdin.write(JSON.stringify(request) + "\n");
                commands.set(cmd.id, cmd);
                commandQueue.push(cmd.id);
            }
            catch (ex) {
                if (ex.message === "This socket is closed.") {
                    killProcess();
                }
                else {
                    handleError("sending cmmand", ex.emssage);
                }
                reject(ex.message);
            }
        });
    }
}

function getNextCommandId(): number {
    return cmdId++;
}

function spawnProcess(dir: string) {

    try {
        proc = cp.spawn(juliaPath, ["completion.jl"], { cwd: dir });
    }
    catch (ex) {
        return handleError("spawnProcess", ex.message);
    }

    proc.stderr.on("data", (data) => {
        //vscode.window.showErrorMessage(data.toString());
        console.log(data.toString());
    });

    proc.on("end", (end) => {
        console.log("spawnProcess.end", "End - " + end);
    });

    proc.on("error", (error) => {
        handleError("error", error);
    });

    proc.stdout.on("data", (data) => {
        handleResponse(data);
    });
}

function handleResponse(data) {
    var dataStr: string = previousData = previousData + data + "";
    if (dataStr[0] !== "{") {
        previousData = "";
        return;
    }    
    var responses: any;
    try {
        responses = dataStr.split(/\r?\n/g).filter(line => line.length > 0).map(resp => JSON.parse(resp));
        previousData = "";
    }
    catch (ex) {
        if (ex.message !== 'Unexpected end of input') {
            handleError("stdout", ex.message);
        }
        return;
    }
    if (typeof responses !== 'object') {
        console.log(responses);
        return;
    }
    responses.forEach((response) => {
        if (typeof response === 'object') {
            let responseId = <number>response["id"];
            if (responseId < 0) {
                vscode.window.showInformationMessage("Result: " + response['results']);
            }
            let cmd = <ICommand>commands.get(responseId);
            if (typeof cmd === "object" && cmd !== null) {
                commands.delete(responseId);
                let index = commandQueue.indexOf(cmd.id);
                commandQueue.splice(index, 1);
                switch (cmd.commandType) {
                    case "completion": {
                        let results = response['results'];
                        let suggestions: vscode.CompletionItem[] = [];
                        for (let i = 0; i < results.length; i++) {
                            let resItem = <IResultItem>results[i];
                            if (typeof results[i] === "object") {
                                let item = new vscode.CompletionItem(resItem.text);
                                item.kind = juliaVSCodeTypeMapping.get(resItem.type);
                                if (resItem.displayText) {
                                    item.label = resItem.displayText;
                                }
                                let insertText = resItem.text;
                                if (insertText.startsWith("@")) {
                                    insertText = insertText.substr(1);
                                }
                                item.insertText = insertText;
                                if (resItem.description) {
                                    item.detail = resItem.description
                                }
                                suggestions.push(item);
                            }
                            else if (typeof results[i] === "string") {
                                let item = new vscode.CompletionItem(results[i]);
                                item.kind = juliaVSCodeTypeMapping.get('keyword');
                                suggestions.push(item);
                            }
                        }
                        cmd.resolve(suggestions);
                    }
                }
            }
        }
    });
    return;
}

function initialize(dir: string) {
    juliaProcessCWD = dir;
    spawnProcess(path.join(dir, "scripts"));
}

function killProcess() {
    try {
        if (proc) {
            proc.kill();
        }
    }
    catch (ex) {
        proc = null;
    }
}

function clearPendingRequests() {
    commandQueue = [];
    commands.forEach(item => {
        item.resolve();
    });
    commands.clear();
}

function handleError(source: string, errorMessage: string) {
    //TO DO 
    console.log(source + "; " + errorMessage);
}

interface IAutoCompletionItem {
    type: vscode.CompletionItemKind;
    kind: vscode.SymbolKind;
    text: string;
    description: string;
    rightLbel: string;
}

// interface for the command in the command queue
interface ICommand {
    id: number;
    commandType: string;
    resolve: (value?: any) => void;
    reject: (ICommandError) => void;
    token: vscode.CancellationToken;
}

// Interface of the request which is send to the server
interface IRequest {
    id?: number;
    requestType: string;
    source: string;
    fileName?: string;
    lineIndex?: number;
    columnIndex?: number;
}

interface ICommandError {
    message: string;
}

interface IResultItem {
    text: string;
    type: string;
    description?: string;
    displayText?: string;
    rightLabel?: string;
}

const juliaVSCodeTypeMapping = new Map<string, vscode.CompletionItemKind>();
juliaVSCodeTypeMapping.set('keyword', vscode.CompletionItemKind.Keyword);
juliaVSCodeTypeMapping.set('package', vscode.CompletionItemKind.Module);
juliaVSCodeTypeMapping.set('λ', vscode.CompletionItemKind.Function);
juliaVSCodeTypeMapping.set('constant', vscode.CompletionItemKind.Variable);
juliaVSCodeTypeMapping.set('macro', vscode.CompletionItemKind.Function);
juliaVSCodeTypeMapping.set('type', vscode.CompletionItemKind.Class);


export function executeJuliaCode() {
    if (!proc) {
        handleError("ExecuteJulia", "Julia is not running");
        return;
    }
    let editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    let selection = editor.selection;
    var text = selection.isEmpty ? editor.document.lineAt(selection.start.line).text : editor.document.getText(selection);
    // If no text was selected, try to move the cursor to the end of the next line
    if (selection.isEmpty) {
        for (var line = selection.start.line + 1; line < editor.document.lineCount; line++) {
            if (!editor.document.lineAt(line).isEmptyOrWhitespace) {
                var newPos = selection.active.with(line, editor.document.lineAt(line).range.end.character);
                var newSel = new vscode.Selection(newPos, newPos);
                editor.selection = newSel;
                break;
            }
        }
    }
    //text = text.replace(/\"/g, '\\\"');
    let request: IRequest = {
        requestType: 'evaluation',
        source: text
    };
    try {
        proc.stdin.write(JSON.stringify(request) + "\n");
    }
    catch (ex) {
        if (ex.message === "This socket is closed.") {
            killProcess();
        }
        else {
            handleError("sending cmmand", ex.emssage);
        }
    }
}
