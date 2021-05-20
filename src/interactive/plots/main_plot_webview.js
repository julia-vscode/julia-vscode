const vscode = acquireVsCodeApi()

function postMessageToHost(type, val) {
    if (type) {
        vscode.postMessage({
            type: type,
            value: val
        })
    }
}

function getPlotElement() {
    let plot_element = document.getElementById('plot-element')
    if (!plot_element) {
        return document.getElementsByTagName('body')[0]
    }

    let canvas = plot_element.getElementsByTagName('canvas')[0]
    if (canvas) {
        return canvas
    } else {
        return plot_element
    }
}

let interval
function getImage() {
    const plot = getPlotElement()
    let width = plot.offsetWidth
    let height = plot.offsetHeight

    html2canvas(plot, { height, width }).then((canvas) => {
        postMessageToHost('thumbnail', canvas.toDataURL('png'))
        clearInterval(interval)
    }, (reason) => {
        console.error('Error in taking thumbnail: ', reason)
    })
}

window.addEventListener('load', getImage)

interval = setInterval(getImage, 1000)
