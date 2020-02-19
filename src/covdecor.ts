import * as vscode from 'vscode';
import * as vslc from 'vscode-languageclient';
import * as path from 'path';
import * as fs from 'async-file';
import * as settings from './settings';

let g_context: vscode.ExtensionContext = null;
let g_settings: settings.ISettings = null;
let g_languageClient: vslc.LanguageClient = null;

export async function coverage_decorations(file_ext :string) {
    let doc = vscode.window.activeTextEditor;
    let lines = doc.document.getText().split('\n');
    let dir = path.dirname(doc.document.fileName)
    let rgx = RegExp(path.basename(doc.document.fileName) + '\..{5}\.' + file_ext)
    
    if (fs.exists(dir))
    {
        let rdir = await fs.readdir(dir)
        let covfile = rdir.find(fname => fname.match(rgx))
        if (covfile && !doc.document.isDirty && (await fs.stat(path.join(dir, covfile))).mtime > (await fs.stat(doc.document.fileName)).mtime) {
            let allocs = await getAllocs(path.join(dir, covfile));
            let allocs1 = allocs.slice().sort().filter(v => v > 0);
            let q20 = allocs1[Math.floor(allocs1.length*(1/5))];
            let q40 = allocs1[Math.floor(allocs1.length*(2/5))];
            let q60 = allocs1[Math.floor(allocs1.length*(3/5))];
            let q80 = allocs1[Math.floor(allocs1.length*(4/5))];

            let totalloc = allocs.reduce((sum, i) => sum + i, 0);

            let dec1 :vscode.DecorationOptions[] = [];
            let dec2 :vscode.DecorationOptions[] = [];
            let dec3 :vscode.DecorationOptions[] = [];
            let dec4 :vscode.DecorationOptions[] = [];
            let dec5 :vscode.DecorationOptions[] = [];
            lines.forEach((line, i) => {
                let ralloc = (allocs[i]/totalloc)*100;
                if (0 < allocs[i] && allocs[i] <= q20) {
                    dec1.push({
                        range: new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, line.length)),
                        renderOptions: {after: {
                            contentText: '    ' + allocs[i].toString() + ' (' + (ralloc).toPrecision(2) + '%)',
                            backgroundColor: '#fdb777',
                            fontStyle: 'italic'
                        }}
                    });
                }
                if (q20 < allocs[i] && allocs[i] <= q40) {
                    dec2.push({
                        range: new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, line.length)),
                        renderOptions: {after: {
                            contentText: '    ' + allocs[i].toString() + ' (' + (ralloc).toPrecision(2) + '%)',
                            backgroundColor: '#fda766',
                            fontStyle: 'italic'
                        }}
                    });
                }
                if (q40 < allocs[i] && allocs[i] <= q60) {
                    dec3.push({
                        range: new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, line.length)),
                        renderOptions: {after: {
                            contentText: '    ' + allocs[i].toString() + ' (' + (ralloc).toPrecision(2) + '%)',
                            backgroundColor: '#fd9346',
                            fontStyle: 'italic'
                        }}
                    });
                }
                if (q60 < allocs[i] && allocs[i] <= q80) {
                    dec4.push({
                        range: new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, line.length)),
                        renderOptions: {after: {
                            contentText: '    ' + allocs[i].toString() + ' (' + (ralloc).toPrecision(2) + '%)',
                            backgroundColor: '#fd7f2c',
                            fontStyle: 'italic'
                        }}
                    });
                }
                if (q80 < allocs[i]) {
                    dec5.push({
                        range: new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, line.length)),
                        renderOptions: {after: {
                            contentText: '    ' + allocs[i].toString() + ' (' + (ralloc).toPrecision(2) + '%)',
                            backgroundColor: '#ff6200',
                            fontStyle: 'italic'
                        }}
                    });
                }
            })
            doc.setDecorations(Decor1, dec1);
            doc.setDecorations(Decor2, dec2);
            doc.setDecorations(Decor3, dec3);
            doc.setDecorations(Decor4, dec4);
            doc.setDecorations(Decor5, dec5);
            vscode.commands.executeCommand('setContext', 'JuliaCodeCoverageShowing', true);
        }
        else {
            vscode.window.showErrorMessage('No valid .cov/.mem file available.')
        }
    }
}

export function removeCodeCoveStatus() {
    vscode.commands.executeCommand('setContext', 'JuliaCodeCoverageShowing', false);
    let doc = vscode.window.activeTextEditor;
    let dec1 :vscode.DecorationOptions[] = [];
    let dec2 :vscode.DecorationOptions[] = [];
    let dec3 :vscode.DecorationOptions[] = [];
    let dec4 :vscode.DecorationOptions[] = [];
    let dec5 :vscode.DecorationOptions[] = [];
    doc.setDecorations(Decor1, dec1);
    doc.setDecorations(Decor2, dec2);
    doc.setDecorations(Decor3, dec3);
    doc.setDecorations(Decor4, dec4);
    doc.setDecorations(Decor5, dec5);
}

async function getAllocs(file:string) {
    let text :string = await fs.readFile(file, {encoding: "utf8"});
    let allocs :number[] = [];
    text.split('\n').forEach((line)=>{
        let alloc = parseInt(line.substring(0, 8))
        if (isNaN(alloc)) {
            allocs.push(0)
        }
        else {
            allocs.push(alloc)
        }
    })
    return allocs
}


const Decor1 = vscode.window.createTextEditorDecorationType({
    overviewRulerColor: "#fdb777"
});
const Decor2 = vscode.window.createTextEditorDecorationType({
    overviewRulerColor: "#fda766"
});

const Decor3 = vscode.window.createTextEditorDecorationType({
    overviewRulerColor: "#fd9346"
});

const Decor4 = vscode.window.createTextEditorDecorationType({
    overviewRulerColor: "#fd7f2c"
});

const Decor5 = vscode.window.createTextEditorDecorationType({
    overviewRulerColor: "#ff6200"
});

export function activate(context: vscode.ExtensionContext, settings: settings.ISettings) {
    g_context = context;
    g_settings = settings;
    vscode.window.onDidChangeActiveTextEditor(() => vscode.commands.executeCommand('setContext', 'JuliaCodeCoverageShowing', false))
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.covDecoration', () => coverage_decorations('cov')));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.memDecoration', () => coverage_decorations('mem')));
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.RemoveCovDecoration', removeCodeCoveStatus));
}