/* eslint-disable semi */
import * as toml from '@iarna/toml';
import { exists, readFile } from 'async-file';
import * as download from 'download';
import { homedir } from 'os';
import * as path from 'path';
import * as tar from 'tar';
import * as vscode from 'vscode';
import { Utils } from 'vscode-uri';
import { getAbsEnvPath } from '../jlpkgenv';

abstract class DocTocNode {

}

class DocTocPackageNode extends DocTocNode {
    getName() {
        return this.name
    }
    constructor(private name: string) {
        super()
    }
}

export class DocTocFeature implements vscode.TreeDataProvider<DocTocNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<DocTocNode | undefined> = new vscode.EventEmitter<DocTocNode | undefined>();
    readonly onDidChangeTreeData: vscode.Event<DocTocNode | undefined> = this._onDidChangeTreeData.event;

    private packageNodes: DocTocPackageNode[] = []

    constructor(private context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.window.registerTreeDataProvider('julia-doctoc', this),
        )

    }

    public async init() {
        const envPath = await getAbsEnvPath()

        const manifest_path = (await exists(path.join(envPath, 'Manifest.toml'))) ?
            path.join(envPath, 'Manifest.toml') :
            (await exists(path.join(envPath, 'JuliaManifest.toml'))) ?
                path.join(envPath, 'JuliaManifest.toml') : null

        if (manifest_path) {
            const fileContent = await readFile(manifest_path)
            const manifestContent = toml.parse(fileContent)

            for (const pkgName in manifestContent) {
                const pkg = manifestContent[pkgName][0]

                if (pkg['git-tree-sha1']) {
                    const path_to_doc_cache = Utils.joinPath(this.context.globalStorageUri, 'doccache', 'v1', 'packages', pkg.uuid, pkg['git-tree-sha1'])

                    if (!await exists(path_to_doc_cache.fsPath)) {
                        const downloadUri = vscode.Uri.parse(`https://www.julia-vscode.org/vscode-doc-cache/store/v1/${pkg.uuid}/${pkg['git-tree-sha1']}.tar.gz`)

                        const downloadPath = homedir()

                        try {
                            await download(downloadUri.toString(), downloadPath)

                            await vscode.workspace.fs.createDirectory(path_to_doc_cache)

                            tar.extract({ file: path.join(downloadPath, `${pkg['git-tree-sha1']}.tar.gz`), cwd: path_to_doc_cache.fsPath })
                        }
                        catch (e) {
                        }
                    }
                }
            }

            for (const pkgName in manifestContent) {
                const pkg = manifestContent[pkgName][0]

                if (pkg['git-tree-sha1']) {
                    const path_to_doc_cache_toc_file = Utils.joinPath(this.context.globalStorageUri, 'doccache', 'v1', 'packages', pkg.uuid, pkg['git-tree-sha1'], 'toc.json')

                    if (await exists(path_to_doc_cache_toc_file.fsPath)) {
                        const contentAsBuffer = await vscode.workspace.fs.readFile(path_to_doc_cache_toc_file)

                        const content = JSON.parse(contentAsBuffer.toString())

                        const node = new DocTocPackageNode(content.project.name)

                        this.packageNodes.push(node)
                    }
                }
            }
        }

        this.refresh()
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined)
    }

    getTreeItem(element: DocTocNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
        if (element instanceof DocTocPackageNode) {
            const item = new vscode.TreeItem(element.getName())
            return item
        }
    }

    getChildren(element?: DocTocNode): vscode.ProviderResult<DocTocNode[]> {
        if (element) {
            return []
        }
        else {
            return [...this.packageNodes]
        }
    }

    public dispose() { }
}
