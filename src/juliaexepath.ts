import * as vscode from 'vscode';
import * as settings from './settings';
import * as vslc from 'vscode-languageclient';
import * as os from 'os';
import * as path from 'path';
import * as process from 'process';
import * as util from 'util';
import * as which from 'which';
var exec = require('child-process-promise').exec;
const whichAsync = util.promisify(which);

let g_context: vscode.ExtensionContext = null;
let g_settings: settings.ISettings = null;
let g_languageClient: vslc.LanguageClient = null;

let actualJuliaExePath: string = null;

export async function getJuliaExePath() {
    if (actualJuliaExePath == null) {
        if (g_settings.juliaExePath == null) {
            let homedir = os.homedir();
            let pathsToSearch = [];
            if (process.platform == "win32") {
                pathsToSearch = ["julia.exe",
                    path.join(homedir, "AppData", "Local", "Julia-1.2.0", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.1.1", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.1.0", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.0.4", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.0.3", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.0.2", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.0.1", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.0.0", "bin", "julia.exe")
                ];
            }
            else if (process.platform == "darwin") {
                pathsToSearch = ["julia",
                    path.join(homedir, "Applications", "Julia-1.2.app", "Contents", "Resources", "julia", "bin", "julia"),
                    path.join("/", "Applications", "Julia-1.2.app", "Contents", "Resources", "julia", "bin", "julia"),
                    path.join(homedir, "Applications", "Julia-1.1.app", "Contents", "Resources", "julia", "bin", "julia"),
                    path.join("/", "Applications", "Julia-1.1.app", "Contents", "Resources", "julia", "bin", "julia"),
                    path.join(homedir, "Applications", "Julia-1.0.app", "Contents", "Resources", "julia", "bin", "julia"),
                    path.join("/", "Applications", "Julia-1.0.app", "Contents", "Resources", "julia", "bin", "julia")];
            }
            else {
                pathsToSearch = ["julia"];
            }
            let foundJulia = false;
            for (let p of pathsToSearch) {
                try {
                    var res = await exec(`"${p}" --startup-file=no --history-file=no -e "println(Sys.BINDIR)"`);
                    if (p == 'julia' || p == "julia.exe") {
                        // use full path
                        actualJuliaExePath = path.join(res.stdout.trim(), p);
                    } else {
                        actualJuliaExePath = p;
                    }
                    foundJulia = true;
                    break;
                }
                catch (e) {
                }
            }
            if (!foundJulia) {
                actualJuliaExePath = g_settings.juliaExePath;
            }
        }
        else {
            if (g_settings.juliaExePath.includes(path.sep)) {
                actualJuliaExePath = g_settings.juliaExePath;
            } else {
                // resolve full path
                actualJuliaExePath = await whichAsync(g_settings.juliaExePath);
            }
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
    }
}

export function onNewLanguageClient(newLanguageClient: vslc.LanguageClient) {
    g_languageClient = newLanguageClient;
}
