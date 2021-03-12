const vscode = acquireVsCodeApi();

function postMessageToHost(type, val) {
    if (type) {
        vscode.postMessage({
            type: type,
            value: val
        });
    }
}

function plotDiscovery() {
    let plot_element = document.getElementById("plotdiv");
    if (!plot_element) {
        return document.getElementsByTagName("body")[0];
    }

    let canvas = plot_element.getElementsByTagName("canvas")[0];
    if (canvas) {
        return canvas;
    } else {
        return plot_element;
    }
}

function getImage() {
    const plot_element = plotDiscovery()
    html2canvas(plot_element, { "height": plot_element.offsetHeight, "width": plot_element.offsetWidth }).then((canvas) => {
        console.log("Thumbnail is taken with", plot_element);
        postMessageToHost("thumbnail", canvas.toDataURL("png"));
    }, (reason) => {
        console.error("Error in taking thumbnail", reason);
    });
}

window.addEventListener('load', getImage);

setInterval(getImage, 1000);
