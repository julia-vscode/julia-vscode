import * as vscode from 'vscode'
import { NotificationType } from 'vscode-jsonrpc'
import * as lsp from 'vscode-languageserver-protocol'

interface Testitem {
    name: string
    range: lsp.Range
}

interface PublishTestitemsParams {
    uri: lsp.URI
    version: number
    testitems: Testitem[]
}

export const notifyTypeTextDocumentPublishTestitems = new NotificationType<PublishTestitemsParams>('julia/publishTestitems')
export class TestFeature {
    private controller: vscode.TestController
    private testitems: WeakMap<vscode.TestItem, Testitem> = new WeakMap<vscode.TestItem, Testitem>()

    constructor(private context: vscode.ExtensionContext) {
        console.log(this.context.extensionUri)

        this.controller = vscode.tests.createTestController(
            'juliaTests',
            'Julia Tests'
        )

        this.controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, this.runHandler.bind(this), true)
        // this.controller.createRunProfile('Debug', vscode.TestRunProfileKind.Debug, this.runHandler.bind(this), false)
        // this.controller.createRunProfile('Coverage', vscode.TestRunProfileKind.Coverage, this.runHandler.bind(this), false)

    }

    public publishTestitemsHandler(params: PublishTestitemsParams) {
        const uri = vscode.Uri.parse(params.uri)

        let fileTestitem = this.controller.items.get(params.uri)

        if (!fileTestitem) {
            const filename = vscode.workspace.asRelativePath(uri.fsPath)

            fileTestitem = this.controller.createTestItem(params.uri, filename, uri)
            this.controller.items.add(fileTestitem)
        }

        fileTestitem.children.replace(params.testitems.map(i => {
            const testitem = this.controller.createTestItem(i.name, i.name, vscode.Uri.parse(params.uri))
            this.testitems.set(testitem, i)
            testitem.range = new vscode.Range(i.range.start.line, i.range.start.character, i.range.end.line, i.range.end.character)

            return testitem
        }))
    }

    walkTestTree(item: vscode.TestItem, itemsToRun: vscode.TestItem[]) {
        if (this.testitems.has(item)) {
            itemsToRun.push(item)
        }
        else {
            item.children.forEach(i=>this.walkTestTree(i, itemsToRun))
        }
    }

    runHandler(
        shouldDebug: boolean,
        request: vscode.TestRunRequest,
        token: vscode.CancellationToken
    ) {
        const testRun = this.controller.createTestRun(request, 'Super run', true)

        const itemsToRun = []

        // TODO Handle exclude
        if (!request.include) {
            this.controller.items.forEach(i=>this.walkTestTree(i, itemsToRun))
        }
        else {
            request.include.forEach(i => this.walkTestTree(i, itemsToRun))
        }

        for (const i of itemsToRun) {
            testRun.passed(i)
        }
        // testRun.failed(this.controller.items.get('test1'), new vscode.TestMessage('Well that did not work'))
        testRun.end()
    }

    public dispose() {

    }
}
