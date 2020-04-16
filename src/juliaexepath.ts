import * as vscode from 'vscode';
import * as settings from './settings';
import * as vslc from 'vscode-languageclient';
import * as os from 'os';
import * as path from 'path';
import * as process from 'process';
import * as util from 'util';
import * as which from 'which';
import * as child_process from 'child_process';
import { setCurrentJuliaVersion, traceEvent } from './telemetry';
import {exec} from 'child-process-promise';
const whichAsync = util.promisify(which);

let g_context: vscode.ExtensionContext = null;
let g_settings: settings.ISettings = null;
let g_languageClient: vslc.LanguageClient = null;

let actualJuliaExePath: string = null;

async function setNewJuliaExePath(newPath: string) {
    actualJuliaExePath = newPath;

    child_process.exec(`"${newPath}" --version`, (error, stdout, stderr) => {
        if (error) {
            return;
        }
        const version = stdout.trim();
        setCurrentJuliaVersion(version);

        traceEvent('configured-new-julia-binary');
    });
}

export async function getJuliaExePath() {
    if (actualJuliaExePath == null) {
        if (g_settings.juliaExePath == null) {
            let homedir = os.homedir();
            let pathsToSearch = [];
            if (process.platform == "win32") {
                pathsToSearch = ["julia.exe",
                    path.join(homedir, "AppData", "Local", "Programs", "Julia", "Julia-1.4.0", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.3.2", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.3.1", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.3.0", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.2.0", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.1.1", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.1.0", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.0.6", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.0.5", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.0.4", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.0.3", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.0.2", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.0.1", "bin", "julia.exe"),
                    path.join(homedir, "AppData", "Local", "Julia-1.0.0", "bin", "julia.exe")
                ];
            }
            else if (process.platform == "darwin") {
                pathsToSearch = ["julia",
                    path.join(homedir, "Applications", "Julia-1.4.app", "Contents", "Resources", "julia", "bin", "julia"),
                    path.join("/", "Applications", "Julia-1.4.app", "Contents", "Resources", "julia", "bin", "julia"),
                    path.join(homedir, "Applications", "Julia-1.3.app", "Contents", "Resources", "julia", "bin", "julia"),
                    path.join("/", "Applications", "Julia-1.3.app", "Contents", "Resources", "julia", "bin", "julia"),
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
                        setNewJuliaExePath(path.join(res.stdout.trim(), p));
                    } else {
                        setNewJuliaExePath(p);
                    }
                    foundJulia = true;
                    break;
                }
                catch (e) {
                }
            }
            if (!foundJulia) {
                setNewJuliaExePath(g_settings.juliaExePath);
            }
        }
        else {
            if (g_settings.juliaExePath.includes(path.sep)) {
                setNewJuliaExePath(g_settings.juliaExePath.replace(/^~/, os.homedir()));
            } else {
                // resolve full path
                setNewJuliaExePath(await whichAsync(g_settings.juliaExePath));
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
