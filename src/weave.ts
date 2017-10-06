import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'async-file';

var tempfs = require('promised-temp').track();
var kill = require('async-child-process').kill;

export class WeaveDocumentContentProvider implements vscode.TextDocumentContentProvider {
    private juliaExecutable
    private extensionPath
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    private lastWeaveContent: string = null;
    private weaveOutputChannel: vscode.OutputChannel = null;
    private weaveChildProcess: ChildProcess = null;
    private weaveNextChildProcess: ChildProcess = null;

    constructor(extensionPath, juliaExecutable) {
        this.extensionPath = extensionPath
        this.juliaExecutable = juliaExecutable
    }

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this.lastWeaveContent;
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public update() {
        this._onDidChange.fire(vscode.Uri.parse('jlweave://nothing.html'));
    }
    
    async weave_core(column, selected_format:string=undefined) {
        let parsed_filename = path.parse(vscode.window.activeTextEditor.document.fileName);
        let weaveProvider = this
    
        let source_filename: string;
        let output_filename: string;
        if (selected_format===undefined) {
            let temporary_dirname = await tempfs.mkdir("julia-vscode-weave");
    
            source_filename = path.join(temporary_dirname, 'source-file.jmd')
    
            await fs.writeFile(source_filename, vscode.window.activeTextEditor.document.getText(), 'utf8');
        
            output_filename = path.join(temporary_dirname, 'output-file.html');
        }
        else {
            source_filename = vscode.window.activeTextEditor.document.fileName;
            output_filename = '';
        }
    
        if (this.weaveOutputChannel == null) {
            this.weaveOutputChannel = vscode.window.createOutputChannel("julia Weave");
        }
        this.weaveOutputChannel.clear();
        this.weaveOutputChannel.show(true);
    
        if (this.weaveChildProcess != null) {
            try {
                await kill(this.weaveChildProcess);
            }
            catch (e) {
            }
        }
    
        if (this.weaveNextChildProcess == null) {
            this.weaveNextChildProcess = spawn(this.juliaExecutable, [path.join(this.extensionPath, 'scripts', 'weave', 'run_weave.jl')]);
        }
        this.weaveChildProcess = this.weaveNextChildProcess;
    
        this.weaveChildProcess.stdin.write(source_filename + '\n');
        this.weaveChildProcess.stdin.write(output_filename + '\n');
        if (selected_format===undefined) {
            this.weaveChildProcess.stdin.write('PREVIEW\n');
        }
        else {
            this.weaveChildProcess.stdin.write(selected_format + '\n');
        }
    
        weaveProvider.weaveNextChildProcess = spawn(this.juliaExecutable, [path.join(weaveProvider.extensionPath, 'scripts', 'weave', 'run_weave.jl')]);
    
        weaveProvider.weaveChildProcess.stdout.on('data', function (data) {
            weaveProvider.weaveOutputChannel.append(String(data));
        });
        weaveProvider.weaveChildProcess.stderr.on('data', function (data) {
            weaveProvider.weaveOutputChannel.append(String(data));
        });
        weaveProvider.weaveChildProcess.on('close', async function (code) {
            weaveProvider.weaveChildProcess = null;
    
            if (code == 0) {
                weaveProvider.weaveOutputChannel.hide();
    
                if (selected_format===undefined) {
                    weaveProvider.lastWeaveContent = await fs.readFile(output_filename, "utf8")
    
                    let uri = vscode.Uri.parse('jlweave://nothing.html');
                    weaveProvider.update();
                    let success = await vscode.commands.executeCommand('vscode.previewHtml', uri, column, "julia Weave Preview");
                }
            }
            else {
                vscode.window.showErrorMessage("Error during weaving.");
            }
    
        });
    }
    
    async open_preview() {
        if (vscode.window.activeTextEditor === undefined) {
            vscode.window.showErrorMessage('Please open a document before you execute the weave command.');
        }
        else if (vscode.window.activeTextEditor.document.languageId!='juliamarkdown') {
            vscode.window.showErrorMessage('Only julia Markdown (.jmd) files can be weaved.');
        }
        else {
            this.weave_core(vscode.ViewColumn.One);
        }
    }
    
    async open_preview_side() {
        if (vscode.window.activeTextEditor === undefined) {
            vscode.window.showErrorMessage('Please open a document before you execute the weave command.');
        }
        else if (vscode.window.activeTextEditor.document.languageId!='juliamarkdown') {
            vscode.window.showErrorMessage('Only julia Markdown (.jmd) files can be weaved.');
        }
        else {
            this.weave_core(vscode.ViewColumn.Two);
        }
    }
    
    async save() {
        if (vscode.window.activeTextEditor === undefined) {
            vscode.window.showErrorMessage('Please open a document before you execute the weave command.');
        }
        else if (vscode.window.activeTextEditor.document.languageId!='juliamarkdown') {
            vscode.window.showErrorMessage('Only julia Markdown (.jmd) files can be weaved.');
        }
        else if (vscode.window.activeTextEditor.document.isDirty || vscode.window.activeTextEditor.document.isUntitled) {
            vscode.window.showErrorMessage('Please save the file before weaving.');
        }
        else {
            let formats = ['github: Github markdown',
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
                'asciidoc: AsciiDoc'];
            let result_format = await vscode.window.showQuickPick(formats, {placeHolder: 'Select output format'});
            if (result_format!=undefined) {
                let index = result_format.indexOf(':');
                let selected_format = result_format.substring(0,index);
                this.weave_core(vscode.ViewColumn.One, selected_format);
            }
        }
    }
}
