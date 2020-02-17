import * as vscode from 'vscode';
import * as vslc from 'vscode-languageclient';
import * as path from 'path';
import * as fs from 'async-file';
let g_languageClient: vslc.LanguageClient = null;

export async function coverage_decorations() {
    let doc = vscode.window.activeTextEditor;
    let lines = doc.document.getText().split('\n');
    let dir = path.dirname(doc.document.fileName)
    let rgx = RegExp(path.basename(doc.document.fileName) + '\..{5}\.mem')
    
    if (fs.exists(dir))
    {
        let rdir = await fs.readdir(dir)
        let covfile = rdir.find(fname => fname.match(rgx))
        if (covfile) {
            // TODO: make sure doc is not dirty and that it's older than covfile.
            let allocs = await getAllocs(path.join(dir, covfile));
            let totalloc = allocs.reduce((sum, i) => sum + i, 0)
            let decranges :vscode.Range[] = [];
            let decopst :vscode.DecorationOptions[] = []
            lines.forEach((line, i) => {
                if (allocs[i] > 0) {
                    decopst.push({
                        range: new vscode.Range(new vscode.Position(i, 0), new vscode.Position(i, line.length)), 
                        hoverMessage: 'Allocations: ' + allocs[i].toString() + 'bytes / ' + ((allocs[i]/totalloc)*100).toPrecision(4) + '%'})
                }
            })
            doc.setDecorations(malloc0, decopst)
        }
    }
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

const malloc0 = vscode.window.createTextEditorDecorationType({
    backgroundColor: "#9999ff", 
    border: "1px solid black"
});
