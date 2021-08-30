import * as path from 'path'
import * as vscode from 'vscode'
import * as rpc from 'vscode-jsonrpc/node'
import { g_connection } from './repl'

const requestTypeGetTableData = new rpc.RequestType < {
    id: string,
    startRow: Number,
    endRow: Number
}, string, void> ('repl/getTableData')

export function displayTable(payload, context, isLazy = false) {
    console.log(payload)


    const panel = vscode.window.createWebviewPanel('jlgrid', 'Julia Table', {
        preserveFocus: true,
        viewColumn: vscode.ViewColumn.Active
    }, {
        enableScripts: true,
        retainContextWhenHidden: true
    })

    const uriAgGrid = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'libs', 'ag-grid', 'ag-grid.js')))
    const uriAgGridCSS = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'libs', 'ag-grid', 'ag-grid.css')))
    const theme = vscode.window.activeColorTheme.kind === 1 ? '' : '-dark'
    const uriAgGridThemeCSS = panel.webview.asWebviewUri(vscode.Uri.file(path.join(context.extensionPath, 'libs', 'ag-grid', `ag-grid-balham${theme}.css`)))

    let script

    if (isLazy) {
        const jPayload = JSON.parse(payload)
        const objectId = jPayload.id

        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'getRows') {
                const data = await g_connection.sendRequest(
                    requestTypeGetTableData,
                    {
                        id: objectId,
                        startRow: message.content.startRow,
                        endRow: message.content.endRow
                    }
                )

                panel.webview.postMessage({
                    type: 'getRows',
                    id: message.id,
                    data: data
                })
            } else {
                console.error('invalid message received: ', message)
            }
        })
        script = `
            <script type="text/javascript">
                const vscodeAPI = acquireVsCodeApi()

                const requests = {}
                const payload = ${payload};

                function getRows({startRow, endRow, context, successCallback, failCallback}) {
                    const id  = Math.random()
                    vscodeAPI.postMessage({
                        type: 'getRows',
                        id: id,
                        content: {
                            startRow, endRow
                        }
                    })
                    requests[id] = {
                        success: successCallback,
                        failure: failCallback
                    }
                }
                window.addEventListener('message', event => {
                    const message = event.data
                    console.log(message)

                    if (message.type === 'getRows') {
                        const callback = requests[message.id]
                        if (callback !== undefined) {
                            if (message.data.error) {
                                callback.failure()
                            } else {
                                callback.success(message.data.rows, message.data.lastRow)
                            }
                            delete requests[message.id]
                        }
                    } else {
                        console.error('invalid message received: ', message)
                    }
                })
                const gridOptions = {
                    columnDefs: payload.coldefs,
                    maxConcurrentDatasourceRequests: 1,
                    cacheBlockSize: 1000,
                    maxBlocksInCache: 100,
                    rowModelType: 'infinite',
                    datasource: {
                        getRows,
                        rowCount: payload.rowCount
                    }
                };
                const eGridDiv = document.querySelector('#myGrid');
                new agGrid.Grid(eGridDiv, gridOptions);
            </script>
        `
    } else {
        script = `
            <script type="text/javascript">
                const payload = ${payload};
                const gridOptions = {
                    columnDefs: payload.coldefs,
                    rowData: payload.data
                };
                const eGridDiv = document.querySelector('#myGrid');
                new agGrid.Grid(eGridDiv, gridOptions);
            </script>
        `
    }


    panel.webview.html = `
            <html>
                <head>
                    <script src="${uriAgGrid}"></script>
                    <link rel="stylesheet" href="${uriAgGridCSS}">
                    <link rel="stylesheet" href="${uriAgGridThemeCSS}">
                </head>
            <body style="padding:0;">
                <div id="myGrid" style="height: 100vh; width: 100vw;" class="ag-theme-balham${theme}"></div>
            </body>
            ${script}
        </html>
        `
}
