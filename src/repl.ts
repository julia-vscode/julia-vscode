import * as vscode from 'vscode';
import * as path from 'path';
import * as net from 'net';
import * as os from 'os';

export class PlotPaneDocumentContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    public plots: Array<string> = new Array<string>();
    public currentPlotIndex: number = 0;

    public provideTextDocumentContent(uri: vscode.Uri): string {
        if(this.plots.length==0) {
            return '<html></html>';
        }
        else {
            return this.plots[this.currentPlotIndex];
        }
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public update() {
        this._onDidChange.fire(vscode.Uri.parse('jlplotpane://nothing.html'));
    }

    public showPlotPane() {
        let uri = vscode.Uri.parse('jlplotpane://nothing.html');
        vscode.commands.executeCommand('vscode.previewHtml', uri, undefined, "julia Plot Pane");
    }
    
    public plotPanePrev() {
        if(this.currentPlotIndex>0) {
            this.currentPlotIndex = this.currentPlotIndex - 1;
            this.update();
        }
    }
    
    public plotPaneNext() {
        if(this.currentPlotIndex<this.plots.length-1) {
            this.currentPlotIndex = this.currentPlotIndex + 1;
            this.update();
        }
    }
    
    public plotPaneFirst() {
        if(this.plots.length>0) {
            this.currentPlotIndex = 0;
            this.update();
        }
    }
    
    public plotPaneLast() {
        if(this.plots.length>0) {
            this.currentPlotIndex = this.plots.length - 1;
            this.update();
        }
    }
    
    public plotPaneDel() {
        if(this.plots.length>0) {
            this.plots.splice(this.currentPlotIndex,1);
            if(this.currentPlotIndex>this.plots.length-1) {
                this.currentPlotIndex = this.plots.length - 1;
            }
            this.update();
        }
    }
}

function generatePipeName(pid: string, name:string) {
    if (process.platform === 'win32') {
        return '\\\\.\\pipe\\' + name + '-' + pid;
    }
    else {
        return path.join(os.tmpdir(), name + '-' + pid);
    }
}

export class REPLHandler implements vscode.TreeDataProvider<string> {
    public terminal: vscode.Terminal = null
    private extensionPath
    private juliaExecutable
    public plotPaneProvider: PlotPaneDocumentContentProvider = new PlotPaneDocumentContentProvider();
    private variables:string = ''
    private _onDidChangeTreeData: vscode.EventEmitter<string | undefined> = new vscode.EventEmitter<string | undefined>();
    readonly onDidChangeTreeData: vscode.Event<string | undefined> = this._onDidChangeTreeData.event;
    
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }


    constructor(extensionPath, juliaExecutable) {
        this.extensionPath = extensionPath
        this.juliaExecutable = juliaExecutable
    }

    getChildren(node?: string) {
        if (node) {
            return [node]
        }
        else {
            if (this.terminal) {
                return this.variables.split(',').slice(1)
            }
            else {
                return ['no repl attached']
            }
        }
    }

    getTreeItem(node: string): vscode.TreeItem {
        let treeItem: vscode.TreeItem = new vscode.TreeItem(node)
        return treeItem;
    }

    public startREPL() {
        if (this.terminal==null) {
            this.startREPLConn()
            this.startPlotDisplayServer()
            let args = path.join(this.extensionPath, 'scripts', 'terminalserver', 'terminalserver.jl')
            this.terminal = vscode.window.createTerminal("julia", this.juliaExecutable, ['-q', '-i', args, process.pid.toString()]);
        }
        this.terminal.show();
    }

    private startREPLConn() {
        let PIPE_PATH = generatePipeName(process.pid.toString(), 'vscode-language-julia-fromrepl');
        let replhandler = this
    
        var server = net.createServer(function(stream) {
            let accumulatingBuffer = new Buffer(0);
    
            stream.on('data', async function(c) {
                accumulatingBuffer = Buffer.concat([accumulatingBuffer, Buffer.from(c)]);
                let bufferResult = accumulatingBuffer.toString()
                let replResponse = accumulatingBuffer.toString().split(",")
    
                if (replResponse[0] == "repl/returnModules") 
                {
                    let result = await vscode.window.showQuickPick(replResponse.slice(1), {placeHolder: 'Switch to Module...'})
                    if (result!=undefined) {
                        replhandler.sendMessage('repl/changeModule: ' + result)
                    }
                }
                if (replResponse[0] == "repl/variables") 
                {
                    replhandler.variables = bufferResult
                    replhandler.refresh()
                }
            });
        });
    
        server.on('close',function(){
            console.log('Server: on close');
        })
    
        server.listen(PIPE_PATH, function(){
            console.log('Server: on listening');
        })
    }

    startPlotDisplayServer() {
        let PIPE_PATH = generatePipeName(process.pid.toString(), 'vscode-language-julia-terminal');

        let plotPaneProvider = this.plotPaneProvider
    
        var server = net.createServer(function(stream) {
            let accumulatingBuffer = new Buffer(0);
    
            stream.on('data', function(c) {
                accumulatingBuffer = Buffer.concat([accumulatingBuffer, Buffer.from(c)]);
                let s = accumulatingBuffer.toString();
                let index_of_sep_1 = s.indexOf(":");
                let index_of_sep_2 = s.indexOf(";");
    
                if(index_of_sep_2>-1) {
                    let mime_type = s.substring(0,index_of_sep_1);
                    let msg_len_as_string = s.substring(index_of_sep_1+1,index_of_sep_2);
                    let msg_len = parseInt(msg_len_as_string);
                    if(accumulatingBuffer.length>=mime_type.length+msg_len_as_string.length+2+msg_len) {
                        let actual_image = s.substring(index_of_sep_2+1);
                        if(accumulatingBuffer.length > mime_type.length+msg_len_as_string.length+2+msg_len) {
                            accumulatingBuffer = Buffer.from(accumulatingBuffer.slice(mime_type.length+msg_len_as_string.length+2+msg_len + 1));
                        }
                        else {
                            accumulatingBuffer = new Buffer(0);
                        }
    
                        if(mime_type=='image/svg+xml') {
                            plotPaneProvider.currentPlotIndex = plotPaneProvider.plots.push(actual_image)-1;
                        }
                        else if(mime_type=='image/png') {
                            let plotPaneContent = '<html><img src="data:image/png;base64,' + actual_image + '" /></html>';
                            plotPaneProvider.currentPlotIndex = plotPaneProvider.plots.push(plotPaneContent)-1;
                        }
                        else {
                            throw new Error();
                        }
                        
                        let uri = vscode.Uri.parse('jlplotpane://nothing.html');
                        plotPaneProvider.update();
                        vscode.commands.executeCommand('vscode.previewHtml', uri, undefined, "julia Plot Pane");
                    }
                }
            });
        });
    
        server.on('close',function(){
            console.log('Server: on close');
        })
    
        server.listen(PIPE_PATH,function(){
            console.log('Server: on listening');
        })
    }

    public executeCode() {
        var editor = vscode.window.activeTextEditor;
        if(!editor) {
            return;
        }
    
        var selection = editor.selection;
    
        var text = selection.isEmpty ? editor.document.lineAt(selection.start.line).text : editor.document.getText(selection);
    
        // If no text was selected, try to move the cursor to the end of the next line
        if (selection.isEmpty) {
            for (var line = selection.start.line+1; line < editor.document.lineCount; line++) {
            if (!editor.document.lineAt(line).isEmptyOrWhitespace) {
                var newPos = selection.active.with(line, editor.document.lineAt(line).range.end.character);
                var newSel = new vscode.Selection(newPos, newPos);
                editor.selection = newSel;
                break;
            }
            }
        }
    
        // This is the version that sends code to the REPL directly
        var lines = text.split(/\r?\n/);
        lines = lines.filter(line=>line!='');
        text = lines.join('\n');
    
        if(!text.endsWith("\n")) {
            text = text + '\n';
        }
    
        this.startREPL();
        this.terminal.show(true);
        this.terminal.sendText(text, false);
    }

    public executeFile() {
        var editor = vscode.window.activeTextEditor;
        if(!editor) {
            return;
        }
        let text = editor.document.getText()
        this.startREPL();
        this.terminal.show(true);
        this.terminal.sendText(text, false);
    }

    public sendMessage(msg: string) {
        this.startREPL()
        let sock = generatePipeName(process.pid.toString(), 'vscode-language-julia-torepl')
    
        let conn = net.connect(sock)
        conn.write(msg + "\n")
        conn.on('error', () => {vscode.window.showErrorMessage("REPL is not open")})
    }
}


