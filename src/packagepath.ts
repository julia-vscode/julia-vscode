import * as vscode from 'vscode';
import * as settings from './settings';
import * as vslc from 'vscode-languageclient';
import * as juliaexepath from './juliaexepath';
var exec = require('child-process-promise').exec;

let g_context: vscode.ExtensionContext = null;
let g_settings: settings.ISettings = null;
let g_languageClient: vslc.LanguageClient = null;

let juliaPackagePath: string = null;

export async function getPkgPath() {
    if (juliaPackagePath == null) {
        let jlexepath = await juliaexepath.getJuliaExePath();
        var res = await exec(`"${jlexepath}" --startup-file=no --history-file=no -e "(oldstdout = stdout;redirect_stdout();using Pkg;p = filter(p-> p != nothing,[(p.new.path) for p in Pkg.status(Pkg.Types.Context(), Pkg.Types.PKGMODE_COMBINED)])[1];redirect_stdout(oldstdout); println(dirname(p)))"`);
        juliaPackagePath = res.stdout.trim();
    }
    return juliaPackagePath;
}

export function activate(context: vscode.ExtensionContext, settings: settings.ISettings) {
    g_context = context;
    g_settings = settings;
}

export function onDidChangeConfiguration(newSettings: settings.ISettings) {
    if (g_settings.juliaExePath != newSettings.juliaExePath) {
        juliaPackagePath = null;        
    }
}

export function onNewLanguageClient(newLanguageClient: vslc.LanguageClient) {
    g_languageClient = newLanguageClient;
}
