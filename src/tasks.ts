import * as fs from 'async-file'
import * as path from 'path'
import * as vscode from 'vscode'
import * as jlpkgenv from './jlpkgenv'
import { JuliaExecutablesFeature } from './juliaexepath'
import * as telemetry from './telemetry'
import { inferJuliaNumThreads } from './utils'

class JuliaTaskProvider {
    constructor(private context: vscode.ExtensionContext, private juliaExecutablesFeature: JuliaExecutablesFeature) { }

    async provideTasks() {
        const emptyTasks: vscode.Task[] = []
        const allTasks: vscode.Task[] = []
        const folders = vscode.workspace.workspaceFolders

        if (!folders) {
            return emptyTasks
        }

        for (let i = 0; i < folders.length; i++) {
            const tasks = await this.provideJuliaTasksForFolder(folders[i])
            allTasks.push(...tasks)
        }
        return allTasks
    }

    async provideJuliaTasksForFolder(folder: vscode.WorkspaceFolder) {
        telemetry.traceEvent('task-provide')
        const emptyTasks: vscode.Task[] = []

        if (folder.uri.scheme !== 'file') {
            return emptyTasks
        }
        const rootPath = folder.uri.fsPath

        try {
            const nthreads = inferJuliaNumThreads()
            const result: vscode.Task[] = []

            const juliaExecutable = await this.juliaExecutablesFeature.getActiveJuliaExecutableAsync()
            const pkgenvpath = await jlpkgenv.getAbsEnvPath()

            if (await fs.exists(path.join(rootPath, 'test', 'runtests.jl'))) {
                const jlargs = [
                    ...juliaExecutable.args,
                    '--color=yes',
                    `--project=${pkgenvpath}`,
                    '-e',
                    `using Pkg; Pkg.test("${folder.name}")`,
                ]

                const env = {}

                if (nthreads === 'auto') {
                    jlargs.splice(1, 0, '--threads=auto')
                } else {
                    env['JULIA_NUM_THREADS'] = nthreads
                }
                const testTask = new vscode.Task(
                    {
                        type: 'julia',
                        command: 'test'
                    },
                    folder,
                    `Run tests`,
                    'Julia',
                    new vscode.ProcessExecution(
                        juliaExecutable.file,
                        jlargs,
                        {
                            env: env
                        }
                    ),
                    ''
                )
                testTask.group = vscode.TaskGroup.Test
                testTask.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true }
                result.push(testTask)

                const jlargs2 = [
                    ...juliaExecutable.args,
                    '--color=yes',
                    `--project=${pkgenvpath}`,
                    path.join(
                        this.context.extensionPath,
                        'scripts',
                        'tasks',
                        'task_test.jl'
                    ),
                    folder.uri.fsPath,
                    vscode.workspace
                        .getConfiguration('julia')
                        .get<boolean>('deleteJuliaCovFiles') ?? false
                        ? 'true'
                        : 'false',
                ]

                if (nthreads === 'auto') {
                    jlargs.splice(1, 0, '--threads=auto')
                }

                const testTaskWithCoverage = new vscode.Task(
                    {
                        type: 'julia',
                        command: 'testcoverage'
                    },
                    folder,
                    `Run tests with coverage`,
                    'Julia',
                    new vscode.ProcessExecution(
                        juliaExecutable.file,
                        jlargs2,
                        {
                            env: env
                        }
                    ),
                    ''
                )
                testTaskWithCoverage.group = vscode.TaskGroup.Test
                testTaskWithCoverage.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true }
                result.push(testTaskWithCoverage)

                // const livetestTask = new vscode.Task({ type: 'julia', command: 'livetest' }, folder, `Run tests live (experimental)`, 'julia', new vscode.ProcessExecution(jlexepath, ['--color=yes', `--project=${pkgenvpath}`, path.join(this.context.extensionPath, 'scripts', 'tasks', 'task_liveunittesting.jl'), folder.name, vscode.workspace.getConfiguration('julia').get('liveTestFile')], { env: { JULIA_NUM_THREADS: inferJuliaNumThreads() } }), '')
                // livetestTask.group = vscode.TaskGroup.Test
                // livetestTask.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true }
                // result.push(livetestTask)

            }

            if (await fs.exists(path.join(rootPath, 'deps', 'build.jl'))) {
                const buildTask = new vscode.Task(
                    {
                        type: 'julia',
                        command: 'build'
                    },
                    folder,
                    `Run build`,
                    'Julia',
                    new vscode.ProcessExecution(
                        juliaExecutable.file,
                        [
                            ...juliaExecutable.args,
                            '--color=yes',
                            `--project=${pkgenvpath}`,
                            '-e',
                            `using Pkg; Pkg.build("${folder.name}")`
                        ])
                    ,
                    ''
                )
                buildTask.group = vscode.TaskGroup.Build
                buildTask.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true }
                result.push(buildTask)
            }

            if (await fs.exists(path.join(rootPath, 'benchmark', 'benchmarks.jl'))) {
                const benchmarkTask = new vscode.Task(
                    {
                        type: 'julia',
                        command: 'benchmark'
                    },
                    folder,
                    `Run benchmark`,
                    'Julia',
                    new vscode.ProcessExecution(
                        juliaExecutable.file,
                        [
                            ...juliaExecutable.args,
                            '--color=yes',
                            `--project=${pkgenvpath}`,
                            '-e',
                            'using PkgBenchmark; benchmarkpkg(Base.ARGS[1], resultfile="benchmark/results.json")',
                            folder.name
                        ]
                    ),
                    ''
                )
                benchmarkTask.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true }
                result.push(benchmarkTask)
            }

            if (await fs.exists(path.join(rootPath, 'docs', 'make.jl'))) {
                const buildTask = new vscode.Task(
                    {
                        type: 'julia',
                        command: 'docbuild'
                    },
                    folder,
                    `Build documentation`,
                    'Julia',
                    new vscode.ProcessExecution(
                        juliaExecutable.file,
                        [
                            ...juliaExecutable.args,
                            `--project=${pkgenvpath}`,
                            '--color=yes',
                            path.join(this.context.extensionPath, 'scripts', 'tasks', 'task_docbuild.jl'),
                            path.join(rootPath, 'docs', 'make.jl'),
                            path.join(rootPath, 'docs', 'build', 'index.html')
                        ],
                        { cwd: rootPath }
                    ),
                    ''
                )
                buildTask.group = vscode.TaskGroup.Build
                buildTask.presentationOptions = { echo: false, focus: false, panel: vscode.TaskPanelKind.Dedicated, clear: true }
                result.push(buildTask)
            }

            return result
        } catch (e) {
            // TODO Let things crash and go to crash reporting
            return emptyTasks
        }
    }

    resolveTask(task: vscode.Task) {
        return undefined
    }
}

export function activate(context: vscode.ExtensionContext, juliaExecutablesFeature: JuliaExecutablesFeature) {
    vscode.tasks.registerTaskProvider('julia', new JuliaTaskProvider(context, juliaExecutablesFeature))
}
