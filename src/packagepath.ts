import * as vscode from 'vscode';
import * as settings from './settings';
import * as vslc from 'vscode-languageclient';
var exec = require('child-process-promise').exec;

let g_context: vscode.ExtensionContext = null;
let g_settings: settings.ISettings = null;
let g_languageClient: vslc.LanguageClient = null;

let juliaPackagePath: string = null;

let actualJuliaExePath: string = null;

export async function getPkgPath() {
    if (juliaPackagePath == null) {
        var res = await exec(`"${getJuliaExePath()}" -e "println(Pkg.dir())"`);
        juliaPackagePath = res.stdout.trim();
    }
    return juliaPackagePath;
}

export async function getJuliaExePath() {
    console.log("A")
    if (actualJuliaExePath == null) {
        if (g_settings.juliaExePath==null) {
            let pathsToSearch = ["C:\Users\david\AppData\Local\julia-0.6\bin\julia.exe"]
            let foundJulia = false;
            for (let path in pathsToSearch) {
                try {
                    var res = await exec(`"${path}"`);
                    actualJuliaExePath = path;
                    foundJulia = true;
                    console.log("B")
                    break;                    
                }
                catch(e) {
                    console.log(e);
                    console.log("Tried something that didn't work");
                }
            }
            if (!foundJulia) {
                actualJuliaExePath = g_settings.juliaExePath;
            }
        }
        else {
            actualJuliaExePath = g_settings.juliaExePath;
        }
    }
    return actualJuliaExePath;
}

export function activate(context: vscode.ExtensionContext, settings: settings.ISettings) {
    g_context = context;
    g_settings = settings;
}

export function onDidChangeConfiguration(newSettings: settings.ISettings) {
    if (g_settings.juliaExePath != newSettings.juliaExePath) {
        actualJuliaExePath = null;
        juliaPackagePath = null;        
    }
}

export function onNewLanguageClient(newLanguageClient: vslc.LanguageClient) {
    g_languageClient = newLanguageClient;
}
