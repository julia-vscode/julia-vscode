const vscode = acquireVsCodeApi()

function postMessageToHost(type, val) {
    if (type) {
        vscode.postMessage({
            type: type,
            value: val
        })
    }
}

function toPlot(index) {
    // Note that index starts from 0
    postMessageToHost('toPlot', index)
}
