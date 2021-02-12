const vscode = acquireVsCodeApi();

function onMessageFromHost(event) {
    console.log("Message received from host:", event);
}

window.addEventListener('message', event => onMessageFromHost);

function postMessageToHost(type, val) {
    if (type) {
        vscode.postMessage({
            type: type,
            value: val
        });
    }
}

function toPlot(index) {
    // Note that index starts from 0
    console.log(`Redirecting to plot ${index + 1}`);
    postMessageToHost("toPlot", index);
}
