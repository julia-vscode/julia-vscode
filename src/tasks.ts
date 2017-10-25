import * as vscode from 'vscode';
import * as vslc from 'vscode-languageclient';
import * as fs from 'async-file';
import * as path from 'path'
import * as settings from './settings'

let g_context: vscode.ExtensionContext = null;
let g_settings: settings.ISettings = null;
let g_languageClient: vslc.LanguageClient = null;

let taskProvider: vscode.Disposable | undefined;

async function getJuliaTasks(): Promise<vscode.Task[]> {
    let workspaceRoot = vscode.workspace.rootPath;

    let emptyTasks: vscode.Task[] = [];

    if (!workspaceRoot) {
        return emptyTasks;
    }

    try {
        const result: vscode.Task[] = [];

        if (await fs.exists(path.join(workspaceRoot, 'test', 'runtests.jl'))) {
            let testTask = new vscode.Task({ type: 'julia', command: 'test' }, `Run tests`, 'julia', new vscode.ProcessExecution(g_settings.juliaExePath, ['--color=yes', '-e', 'Pkg.test(Base.ARGS[1])', vscode.workspace.rootPath]), "");
            testTask.group = vscode.TaskGroup.Test;
            testTask.presentationOptions = { echo: false };
            result.push(testTask);
        }

        if (await fs.exists(path.join(workspaceRoot, 'deps', 'build.jl'))) {
            let splitted_path = vscode.workspace.rootPath.split(path.sep);
            let package_name = splitted_path[splitted_path.length-1];
            let buildTask = new vscode.Task({ type: 'julia', command: 'build'}, `Run build`, 'julia', new vscode.ProcessExecution(g_settings.juliaExePath, ['--color=yes', '-e', 'Pkg.build(Base.ARGS[1])', package_name]), "");
            buildTask.group = vscode.TaskGroup.Build;
            buildTask.presentationOptions = { echo: false };
            result.push(buildTask);
        }

        if (await fs.exists(path.join(workspaceRoot, 'benchmark', 'benchmarks.jl'))) {
            let splitted_path = vscode.workspace.rootPath.split(path.sep);
            let package_name = splitted_path[splitted_path.length-1];
            let benchmarkTask = new vscode.Task({ type: 'julia', command: 'benchmark'}, `Run benchmark`, 'julia', new vscode.ProcessExecution(g_settings.juliaExePath, ['--color=yes', '-e', 'using PkgBenchmark; benchmarkpkg(Base.ARGS[1], promptsave=false, promptoverwrite=false)', package_name]), "");
            benchmarkTask.presentationOptions = { echo: false };
            result.push(benchmarkTask);
        }

        if (await fs.exists(path.join(workspaceRoot, 'docs', 'make.jl'))) {
            let buildTask = new vscode.Task({ type: 'julia', command: 'docbuild'}, `Build documentation`, 'julia', new vscode.ProcessExecution(g_settings.juliaExePath, ['--color=yes', '-e', 'include(Base.ARGS[1])', path.join(workspaceRoot, 'docs', 'make.jl')]), "");
            buildTask.group = vscode.TaskGroup.Build;
            buildTask.presentationOptions = { echo: false };
            result.push(buildTask);
        }

        return Promise.resolve(result);
    } catch (e) {
        return Promise.resolve(emptyTasks);
    }
}

export function activate(context: vscode.ExtensionContext, settings: settings.ISettings) {
    g_context = context;
    g_settings = settings;

    taskProvider = vscode.workspace.registerTaskProvider('julia', {
        provideTasks: () => {
            return getJuliaTasks();
        },
        resolveTask(_task: vscode.Task): vscode.Task | undefined {
            return undefined;
        }
    });
}

export function onDidChangeConfiguration(newSettings: settings.ISettings) {

}

export function onNewLanguageClient(newLanguageClient: vslc.LanguageClient) {
    g_languageClient = newLanguageClient;
}
