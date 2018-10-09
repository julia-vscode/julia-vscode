import * as vscode from 'vscode';
import * as vslc from 'vscode-languageclient';
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'async-file';
import * as settings from './settings'
import * as juliaexepath from './juliaexepath';
import * as telemetry from './telemetry';
import { stringify } from 'querystring';

var tempfs = require('promised-temp').track();
var kill = require('async-child-process').kill;

let g_context: vscode.ExtensionContext = null;
let g_settings: settings.ISettings = null;
let g_languageClient: vslc.LanguageClient = null;

let g_lastWeaveContent: string = null;
let g_weaveOutputChannel: vscode.OutputChannel = null;
let g_weaveChildProcess: ChildProcess = null;
let g_weaveNextChildProcess: ChildProcess = null;


export class WeaveDocumentContentProvider implements vscode.TextDocumentContentProvider {
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

    public provideTextDocumentContent(uri: vscode.Uri): string {
        return g_lastWeaveContent;
    }

    get onDidChange(): vscode.Event<vscode.Uri> {
        return this._onDidChange.event;
    }

    public update() {
        this._onDidChange.fire(vscode.Uri.parse('jlweave://nothing.html'));
    }
}

let g_weaveProvider: WeaveDocumentContentProvider = null;

async function weave_core(column, selected_format: string = undefined) {
    let parsed_filename = path.parse(vscode.window.activeTextEditor.document.fileName);

    let source_filename: string;
    let output_filename: string;
    if (selected_format === undefined) {
        let temporary_dirname = await tempfs.mkdir("julia-vscode-weave");

        source_filename = path.join(temporary_dirname, 'source-file.jmd')

        let source_text = vscode.window.activeTextEditor.document.getText()

        await fs.writeTextFile(source_filename, source_text, 'utf8');

        output_filename = path.join(temporary_dirname, 'output-file.html');
    }
    else {
        source_filename = vscode.window.activeTextEditor.document.fileName;
        let output_uri = await vscode.window.showSaveDialog({});
        output_filename = output_uri.fsPath;
    }

    if (g_weaveOutputChannel == null) {
        g_weaveOutputChannel = vscode.window.createOutputChannel("julia Weave");
    }
    g_weaveOutputChannel.clear();
    g_weaveOutputChannel.show(true);

    if (g_weaveChildProcess != null) {
        try {
            await kill(g_weaveChildProcess);
        }
        catch (e) {
        }
    }

    let jlexepath = await juliaexepath.getJuliaExePath();

    if (g_weaveNextChildProcess == null) {
        g_weaveNextChildProcess = spawn(jlexepath, [path.join(g_context.extensionPath, 'scripts', 'weave', 'run_weave.jl')]);
    }
    g_weaveChildProcess = g_weaveNextChildProcess;

    g_weaveChildProcess.stdin.write(source_filename + '\n');
    g_weaveChildProcess.stdin.write(output_filename + '\n');
    if (selected_format === undefined) {
        g_weaveChildProcess.stdin.write('PREVIEW\n');
        g_weaveOutputChannel.append(String('Weaving preview of ' + source_filename + '\n'));
    }
    else {
        g_weaveChildProcess.stdin.write(selected_format + '\n');
        g_weaveOutputChannel.append(String('Weaving ' + source_filename + ' to ' + output_filename + '\n'));
    }

    g_weaveNextChildProcess = spawn(jlexepath, [path.join(g_context.extensionPath, 'scripts', 'weave', 'run_weave.jl')]);

    g_weaveChildProcess.stdout.on('data', function (data) {
        g_weaveOutputChannel.append(String(data));
    });
    g_weaveChildProcess.stderr.on('data', function (data) {
        g_weaveOutputChannel.append(String(data));
    });
    g_weaveChildProcess.on('close', async function (code) {
        g_weaveChildProcess = null;

        if (code == 0) {
            g_weaveOutputChannel.hide();

            if (selected_format === undefined) {
                g_lastWeaveContent = await fs.readFile(output_filename, "utf8")

                let uri = vscode.Uri.parse('jlweave://nothing.html');
                g_weaveProvider.update();
                let success = await vscode.commands.executeCommand('vscode.previewHtml', uri, column, "julia Weave Preview");
            }
        }
        else {
            vscode.window.showErrorMessage("Error during weaving.");
        }

    });
}

async function open_preview() {
    telemetry.traceEvent('command-weaveopenpreview');

    if (vscode.window.activeTextEditor === undefined) {
        vscode.window.showErrorMessage('Please open a document before you execute the weave command.');
    }
    else if (vscode.window.activeTextEditor.document.languageId != 'juliamarkdown') {
        vscode.window.showErrorMessage('Only julia Markdown (.jmd) files can be weaved.');
    }
    else {
        await weave_core(vscode.ViewColumn.One);
    }
}

async function open_preview_side() {
    telemetry.traceEvent('command-weaveopenpreviewside');

    if (vscode.window.activeTextEditor === undefined) {
        vscode.window.showErrorMessage('Please open a document before you execute the weave command.');
    }
    else if (vscode.window.activeTextEditor.document.languageId != 'juliamarkdown') {
        vscode.window.showErrorMessage('Only julia Markdown (.jmd) files can be weaved.');
    }
    else {
        weave_core(vscode.ViewColumn.Two);
    }
}

async function save() {
    telemetry.traceEvent('command-weavesave');

    if (vscode.window.activeTextEditor === undefined) {
        vscode.window.showErrorMessage('Please open a document before you execute the weave command.');
    }
    else if (vscode.window.activeTextEditor.document.languageId != 'juliamarkdown') {
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
        let result_format = await vscode.window.showQuickPick(formats, { placeHolder: 'Select output format' });
        if (result_format != undefined) {
            let index = result_format.indexOf(':');
            let selected_format = result_format.substring(0, index);
            weave_core(vscode.ViewColumn.One, selected_format);
        }
    }
}

export function activate(context: vscode.ExtensionContext, settings: settings.ISettings) {
    g_context = context;
    g_settings = settings;

    // Weave
    g_weaveProvider = new WeaveDocumentContentProvider();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('jlweave', g_weaveProvider));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.weave-open-preview', open_preview));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.weave-open-preview-side', open_preview_side));

    context.subscriptions.push(vscode.commands.registerCommand('language-julia.weave-save', save));
}

export function onDidChangeConfiguration(newSettings: settings.ISettings) {

}

export function onNewLanguageClient(newLanguageClient: vslc.LanguageClient) {
    g_languageClient = newLanguageClient;
}
