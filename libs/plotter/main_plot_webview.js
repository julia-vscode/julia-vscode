const vscode = acquireVsCodeApi();

function onMessageFromHost(event) {
    console.log("Message received from host:", event);
}

window.addEventListener('message', onMessageFromHost);

function postMessageToHost(type, val) {
    if (type) {
        vscode.postMessage({
            type: type,
            value: val
        });
    }
}

window.addEventListener('load', _ => {
    html2canvas(document.getElementsByTagName("body")[0], {
        onrendered: (canvas) => {
            console.log("Thumbnail is taken")
            postMessageToHost("thumbnail", canvas.toDataURL("png"))
        }
    })
})
