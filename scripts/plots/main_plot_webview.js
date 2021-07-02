const vscode = acquireVsCodeApi()

function postMessageToHost(type, val) {
    if (type) {
        vscode.postMessage({
            type: type,
            value: val,
        })
    }
}

function getPlotElement() {
    const plot_element = document.getElementById('plot-element')
    if (!plot_element) {
        return document.getElementsByTagName('body')[0]
    }

    const canvas = plot_element.getElementsByTagName('canvas')[0]
    if (canvas) {
        return canvas
    } else {
        return plot_element
    }
}

let interval
function getImage() {
    const plot = getPlotElement()
    const width = plot.offsetWidth
    const height = plot.offsetHeight

    html2canvas(plot, { height, width }).then(
        (canvas) => {
            postMessageToHost('thumbnail', canvas.toDataURL('png'))
            clearInterval(interval)
        },
        (reason) => {
            console.error('Error in taking thumbnail: ', reason)
        }
    )
}

window.addEventListener('load', getImage)

function exportPlot(index) {
    postMessageToHost('exportPlot', index)
}

interval = setInterval(getImage, 1000)
