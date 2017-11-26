import * as vscode from 'vscode';
import * as vslc from 'vscode-languageclient';
import * as fs from 'async-file';
import * as path from 'path'
import * as settings from './settings'

let g_context: vscode.ExtensionContext = null;
let g_settings: settings.ISettings = null;
let g_languageClient: vslc.LanguageClient = null;

let taskProvider: vscode.Disposable | undefined;

async function provideJuliaTasks(): Promise<vscode.Task[]> {
	let emptyTasks: vscode.Task[] = [];
	let allTasks: vscode.Task[] = [];
	let folders = vscode.workspace.workspaceFolders;

	if (!folders) {
		return emptyTasks;
	}
	try {
		for (let i = 0; i < folders.length; i++) {
            let tasks = await provideJuliaTasksForFolder(folders[i]);
			allTasks.push(...tasks);
		}
		return Promise.resolve(allTasks);
	} catch (error) {
		return Promise.reject(error);
	}
}

async function provideJuliaTasksForFolder(folder: vscode.WorkspaceFolder): Promise<vscode.Task[]> {
	let emptyTasks: vscode.Task[] = [];
    
    if (folder.uri.scheme !== 'file') {
        return emptyTasks;
    }
    let rootPath = folder.uri.fsPath;
       
    try {
        const result: vscode.Task[] = [];

        if (await fs.exists(path.join(rootPath, 'test', 'runtests.jl'))) {
            let testTask = new vscode.Task({ type: 'julia', command: 'test' }, folder, `Run tests`, 'julia', new vscode.ProcessExecution(g_settings.juliaExePath, ['--color=yes', '-e', 'Pkg.test(Base.ARGS[1])', rootPath]), "");
            testTask.group = vscode.TaskGroup.Test;
            testTask.presentationOptions = { echo: false };
            result.push(testTask);   
        }

        if (await fs.exists(path.join(rootPath, 'REQUIRE'))) {
            let scriptpath = path.join(g_context.extensionPath, 'scripts', 'test_deps.jl')
            let depTestTask = new vscode.Task({ type: 'julia', command: 'test' }, folder, `Run tests on dependents`, 'julia', new vscode.ProcessExecution(g_settings.juliaExePath, ['--color=yes', '-e', 'include("' + scriptpath + '")', path.basename(rootPath)]), "");
            
            depTestTask.group = vscode.TaskGroup.Test;
            depTestTask.presentationOptions = { echo: false };
            result.push(depTestTask);   
        }

        if (await fs.exists(path.join(rootPath, 'deps', 'build.jl'))) {
            let splitted_path = rootPath.split(path.sep);
            let package_name = splitted_path[splitted_path.length - 1];
            let buildTask = new vscode.Task({ type: 'julia', command: 'build' }, folder, `Run build`, 'julia', new vscode.ProcessExecution(g_settings.juliaExePath, ['--color=yes', '-e', 'Pkg.build(Base.ARGS[1])', package_name]), "");
            buildTask.group = vscode.TaskGroup.Build;
            buildTask.presentationOptions = { echo: false };
            result.push(buildTask);
        }

        if (await fs.exists(path.join(rootPath, 'benchmark', 'benchmarks.jl'))) {
            let splitted_path = rootPath.split(path.sep);
            let package_name = splitted_path[splitted_path.length - 1];
            let benchmarkTask = new vscode.Task({ type: 'julia', command: 'benchmark' }, folder, `Run benchmark`, 'julia', new vscode.ProcessExecution(g_settings.juliaExePath, ['--color=yes', '-e', 'using PkgBenchmark; benchmarkpkg(Base.ARGS[1], promptsave=false, promptoverwrite=false)', package_name]), "");
            benchmarkTask.presentationOptions = { echo: false };
            result.push(benchmarkTask);
        }

        if (await fs.exists(path.join(rootPath, 'docs', 'make.jl'))) {
            let buildTask = new vscode.Task({ type: 'julia', command: 'docbuild' }, folder, `Build documentation`, 'julia', new vscode.ProcessExecution(g_settings.juliaExePath, ['--color=yes', '-e', 'include(Base.ARGS[1])', path.join(rootPath, 'docs', 'make.jl')]), "");
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
            return provideJuliaTasks();
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
