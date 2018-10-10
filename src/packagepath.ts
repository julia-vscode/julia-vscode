import * as vscode from 'vscode';
import * as settings from './settings';
import * as vslc from 'vscode-languageclient';
import * as juliaexepath from './juliaexepath';
import { FILE } from 'dns';
import { join } from 'path';
import * as fs from 'async-file';
var exec = require('child-process-promise').exec;

let g_context: vscode.ExtensionContext = null;
let g_settings: settings.ISettings = null;
let g_languageClient: vslc.LanguageClient = null;

let juliaPackagePath: string = null;

export async function getPkgPath() {
    if (juliaPackagePath == null) {
        let jlexepath = await juliaexepath.getJuliaExePath();
        // TODO: there's got to be a better way to do this.
        var res = await exec(`"${jlexepath}" --startup-file=no --history-file=no -e "(using Pkg;println(dirname([u[1][string(:path)] for (p,u) in Pkg.Types.Context().env.manifest if haskey(u[1], string(:path))][1])))"`);
        juliaPackagePath = res.stdout.trim();
    }
    return juliaPackagePath;
}

export async function checkPackageStore(context: vscode.ExtensionContext) {
    let storedir = join(context.extensionPath, "scripts", "languageserver", "packages", "StaticLint", "store"); 
    if (fs.exists(storedir)) {
        let files = await fs.readdir(storedir);
        let filteredfiles = files.filter(path => path.endsWith('.jstore'));
        if (filteredfiles.length == 0) {
            vscode.window.showInformationMessage("Julia package store is empty: initialising.");
            buildPackageStore(context);
        }
    }
    else {
        vscode.window.showErrorMessage("StaticLint does not appear to be installed correctly, " + storedir + " not found.");
    }

}

export async function buildPackageStore(context: vscode.ExtensionContext) {
    let jlexepath = await juliaexepath.getJuliaExePath();
    let buildscript = join(context.extensionPath, "scripts", "languageserver", "buildscript.jl"); 
    var res = exec(`"${jlexepath}" --startup-file=no --history-file=no ${buildscript}`);
    vscode.window.showInformationMessage("Julia package store saved")
}

export function activate(context: vscode.ExtensionContext, settings: settings.ISettings) {    
    g_context = context;
    g_settings = settings;
    context.subscriptions.push(vscode.commands.registerCommand('language-julia.build-store', () => {buildPackageStore(context)}));
}   

export function onDidChangeConfiguration(newSettings: settings.ISettings) {
    if (g_settings.juliaExePath != newSettings.juliaExePath) {
        juliaPackagePath = null;        
    }
}

export function onNewLanguageClient(newLanguageClient: vslc.LanguageClient) {
    g_languageClient = newLanguageClient;
}
