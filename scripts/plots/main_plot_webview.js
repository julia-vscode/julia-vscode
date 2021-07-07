'use strict'

const vscode = acquireVsCodeApi()
let interval
let g_svgPanZoomController

function postMessageToHost(type, value) {
    if (type) {
        vscode.postMessage({
            type,
            value,
        })
    }
}

function getPlotElement() {
    const plot_element = document.getElementById('plot-element')
    if (!plot_element) {
        return document.getElementsByTagName('body')[0]
    }

    const canvas = plot_element.getElementsByTagName('canvas')[0]
    return canvas ?? plot_element
}

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

function isPlotly() {
    return document.querySelector('#plot-element .plotly') !== null
}

function isSvgTag() {
    return document.querySelector('svg') !== null
}

/**
 *
 * @param {string} reqType
 * @returns
 */
function isPlotZoomRequest(reqType) {
    return [
        REQUEST_ZOOM_IN_PLOT_TYPE,
        REQUEST_ZOOM_RESET_PLOT_TYPE,
        REQUEST_ZOOM_OUT_PLOT_TYPE,
    ].some((t) => t === reqType)
}

const SAVE_PLOT_MESSAGE_TYPE = 'savePlot'
const REQUEST_SAVE_PLOT_TYPE = 'requestSavePlot'
const REQUEST_COPY_PLOT_TYPE = 'requestCopyPlot'
const COPY_FAILED_MESSAGE_TYPE = 'copyFailed'
const REQUEST_ZOOM_IN_PLOT_TYPE = 'requestZoomInPlot'
const REQUEST_ZOOM_RESET_PLOT_TYPE = 'requestZoomResetPlot'
const REQUEST_ZOOM_OUT_PLOT_TYPE = 'requestZoomOutPlot'

/**
 * Fires when a plot export request(save/copy) is received, sends a message to the host with
 * i.  The plot data url,
 * ii. The index of the plot.
 * @param {number} index
 */
function handlePlotSaveRequest(index) {
    const plot = getPlotElement()
    if (isPlotly()) {
        Plotly.Snapshot.toImage(plot, { format: 'svg' }).once('success', (url) => {
            const svg = decodeURIComponent(url).replace(/data:image\/svg\+xml,/, '')

            postMessageToHost(SAVE_PLOT_MESSAGE_TYPE, { svg, index })
        })
    } else if (isSvgTag()) {
        const svg = document.querySelector('svg').outerHTML

        postMessageToHost(SAVE_PLOT_MESSAGE_TYPE, { svg, index })
    } else {
        const { src } = plot

        const svg = src.includes('image/svg')
            ? decodeURIComponent(src).replace(/data:image\/svg\+xml,/, '')
            : null
        const png = src.includes('image/png')
            ? src.replace(/data:image\/png;base64,/, '')
            : null
        const gif = src.includes('image/gif')
            ? src.replace(/data:image\/gif;base64,/, '')
            : null

        postMessageToHost(SAVE_PLOT_MESSAGE_TYPE, { svg, png, gif, index })
    }
}

function handlePlotCopyRequest() {
    const plot = document.querySelector('svg') || getPlotElement()
    const isSvg = document.querySelector('svg') !== null

    const width = plot.offsetWidth
    const height = plot.offsetHeight

    if (isSvg) {
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')

        const image = new Image()
        const data = new XMLSerializer().serializeToString(plot)
        const blob = new Blob([data], { type: 'image/svg+xml;charset=utf-8' })
        const url = window.URL.createObjectURL(blob)

        image.onload = () => {
            canvas.width = image.naturalWidth
            canvas.height = image.naturalHeight
            ctx.drawImage(image, 0, 0)
            window.URL.revokeObjectURL(url)

            canvas.toBlob((blob) => {
                navigator.clipboard.write([
                    new ClipboardItem({
                        [blob.type]: blob,
                    }),
                ])
            })
        }
        image.src = url
    } else {
        html2canvas(plot, { height, width }).then(
            (canvas) => {
                canvas.toBlob((blob) => {
                    navigator.clipboard.write([
                        new ClipboardItem({
                            [blob.type]: blob,
                        }),
                    ])
                })
            },
            (reason) => {
                postMessageToHost(COPY_FAILED_MESSAGE_TYPE)
                console.error(new Error(reason))
            }
        )
    }
}

/**
 *
 * @param {number} index
 * @param { REQUEST_ZOOM_IN_PLOT_TYPE | REQUEST_ZOOM_RESET_PLOT_TYPE | REQUEST_ZOOM_OUT_PLOT_TYPE } reqType
 */
function handlePlotZoomRequest(index, reqType) {
    switch (reqType) {
    case REQUEST_ZOOM_IN_PLOT_TYPE:
        g_svgPanZoomController.zoomIn()
        break
    case REQUEST_ZOOM_RESET_PLOT_TYPE:
        g_svgPanZoomController.reset()
        break
    case REQUEST_ZOOM_OUT_PLOT_TYPE:
        g_svgPanZoomController.zoomOut()
        break
    default:
        console.error(new Error('Unknown plot request!'))
    }
}

/**
 * Remove Plotly builtin export button; it's nonfunctional in VSCode and can confuse users.
 */
function removePlotlyBuiltinExport() {
    if (isPlotly()) {
        document.querySelector(
            '[data-title="Download plot as a png"]'
        ).style.display = 'none'
    }
}

function initSvgPanZoom() {
    const svgTag = document.querySelector('svg')

    g_svgPanZoomController = svgPanZoom(svgTag, {
        panEnabled: true,
        zoomEnabled: true,
        dblClickZoomEnabled: true,
        mouseWheelZoomEnabled: true,
        preventMouseEventsDefault: true,
        zoomScaleSensitivity: 0.2,
        minZoom: 1,
        maxZoom: 10,
        fit: true,
        center: true,
        refreshRate: 'auto',
    })
}

window.addEventListener('load', getImage)
window.addEventListener('load', () => {
    removePlotlyBuiltinExport()
    if (!isPlotly()) {
        initSvgPanZoom()
    }
})

window.addEventListener('message', ({ data }) => {
    const { index } = data.body

    if (isPlotZoomRequest(data.type)) {
        handlePlotZoomRequest(index, data.type)
        return
    }

    switch (data.type) {
    case REQUEST_SAVE_PLOT_TYPE:
        handlePlotSaveRequest(data.body.index)
        break
    case REQUEST_COPY_PLOT_TYPE:
        handlePlotCopyRequest()
        break
    default:
        console.error(new Error('Unknown plot request!'))
    }
})

interval = setInterval(getImage, 1000)
