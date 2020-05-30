import * as vscode from 'vscode';
import * as vslc from 'vscode-languageclient';
import * as fs from 'async-file';
import * as path from 'path'
import * as settings from './settings'
import * as juliaexepath from './juliaexepath';
import * as jlpkgenv from './jlpkgenv';
import * as telemetry from './telemetry';
import { inferJuliaNumThreads } from './utils';
import { onSetLanguageClient, onDidChangeConfig } from './extension';

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
    telemetry.traceEvent('task-provide');
    let emptyTasks: vscode.Task[] = [];

    if (folder.uri.scheme !== 'file') {
        return emptyTasks;
    }
    let rootPath = folder.uri.fsPath;

    try {
        const result: vscode.Task[] = [];

        let jlexepath = await juliaexepath.getJuliaExePath();
        let pkgenvpath = await jlpkgenv.getEnvPath();

        if (await fs.exists(path.join(rootPath, 'test', 'runtests.jl'))) {
            let testTask = new vscode.Task({ type: 'julia', command: 'test' }, folder, `Run tests`, 'julia', new vscode.ProcessExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, '-e', `using Pkg; Pkg.test("${folder.name}")`], { env: { JULIA_NUM_THREADS: inferJuliaNumThreads() } }), "");
            testTask.group = vscode.TaskGroup.Test;
            testTask.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true };
            result.push(testTask);

            let testTaskWithCoverage = new vscode.Task({ type: 'julia', command: 'testcoverage' }, folder, `Run tests with coverage`, 'julia', new vscode.ProcessExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, path.join(g_context.extensionPath, 'scripts', 'tasks', 'task_test.jl'), folder.name], { env: { JULIA_NUM_THREADS: inferJuliaNumThreads() } }), "");
            testTaskWithCoverage.group = vscode.TaskGroup.Test;
            testTaskWithCoverage.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true };
            result.push(testTaskWithCoverage);
        }

        let buildJuliaSysimage = new vscode.Task({ type: 'julia', command: 'juliasysimagebuild' }, folder, `Build custom sysimage for current environment (experimental)`, 'julia', new vscode.ProcessExecution(jlexepath, ['--color=yes', `--project=${path.join(g_context.extensionPath, 'scripts', 'tasks', 'sysimageenv')}`, '--startup-file=no', '--history-file=no', path.join(g_context.extensionPath, 'scripts', 'tasks', 'task_compileenv.jl'), pkgenvpath]), "");
        buildJuliaSysimage.group = vscode.TaskGroup.Build;
        buildJuliaSysimage.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true };
        result.push(buildJuliaSysimage);

        if (await fs.exists(path.join(rootPath, 'deps', 'build.jl'))) {
            let buildTask = new vscode.Task({ type: 'julia', command: 'build' }, folder, `Run build`, 'julia', new vscode.ProcessExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, '-e', `using Pkg; Pkg.build("${folder.name}")`]), "");
            buildTask.group = vscode.TaskGroup.Build;
            buildTask.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true };
            result.push(buildTask);
        }

        if (await fs.exists(path.join(rootPath, 'benchmark', 'benchmarks.jl'))) {
            let benchmarkTask = new vscode.Task({ type: 'julia', command: 'benchmark' }, folder, `Run benchmark`, 'julia', new vscode.ProcessExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, '-e', 'using PkgBenchmark; benchmarkpkg(Base.ARGS[1], promptsave=false, promptoverwrite=false)', folder.name]), "");
            benchmarkTask.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true };
            result.push(benchmarkTask);
        }

        if (await fs.exists(path.join(rootPath, 'docs', 'make.jl'))) {
            let buildTask = new vscode.Task(
                { type: 'julia', command: 'docbuild' },
                folder,
                `Build documentation`,
                'julia',
                new vscode.ProcessExecution(
                    jlexepath,
                    [
                        `--project=${pkgenvpath}`,
                        '--color=yes',
                        path.join(g_context.extensionPath, 'scripts', 'tasks', 'task_docbuild.jl'),
                        path.join(rootPath, 'docs', 'make.jl'),
                        path.join(rootPath, 'docs', 'build', 'index.html')
                    ],
                    { cwd: rootPath }
                ),
                ""
            );
            buildTask.group = vscode.TaskGroup.Build;
            buildTask.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true };
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

    context.subscriptions.push(onSetLanguageClient(languageClient => {
        g_languageClient = languageClient
    }))
    context.subscriptions.push(onDidChangeConfig(newSettings => { }))

    taskProvider = vscode.workspace.registerTaskProvider('julia', {
        provideTasks: () => {
            return provideJuliaTasks();
        },
        resolveTask(_task: vscode.Task): vscode.Task | undefined {
            return undefined;
        }
    });
}
