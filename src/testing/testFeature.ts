import * as vscode from 'vscode'

export class TestFeature {
    private controller: vscode.TestController

    constructor(private context: vscode.ExtensionContext) {
        console.log(this.context.extensionUri)

        this.controller = vscode.tests.createTestController(
            'juliaTests',
            'Julia Tests'
        )

        const test1 = this.controller.createTestItem('test1', 'Test 1', vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'foo.jl'))
        test1.range = new vscode.Range(3, 0, 5, 0)
        this.controller.items.add(test1)

        const test2 = this.controller.createTestItem('test2', 'Test 2')
        this.controller.items.add(test2)

        this.controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, this.runHandler.bind(this), true)
        this.controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, this.runHandler.bind(this), false)
        this.controller.createRunProfile('Coverage', vscode.TestRunProfileKind.Coverage, this.runHandler.bind(this), false)
    }

    runHandler(
        shouldDebug: boolean,
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken
    ) {
        const testRun = this.controller.createTestRun(request, 'Super run')
        testRun.passed(this.controller.items.get('test2'))
        testRun.failed(this.controller.items.get('test1'), new vscode.TestMessage('Well that did not work'))
        testRun.end()
    }

    public dispose() {

    }
}
