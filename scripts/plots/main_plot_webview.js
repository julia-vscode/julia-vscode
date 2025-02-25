'use strict'

const vscode = acquireVsCodeApi()

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
        return document.body
    }

    const canvas = plot_element.getElementsByTagName('canvas')[0]
    return canvas ?? plot_element
}

let isGenerating = false
function postThumbnailToNavigator() {
    const plot = getPlotElement()
    const width = plot.offsetWidth
    const height = plot.offsetHeight
    if (width > 0 && height > 0) {
        if (isGenerating) {
            return
        }
        isGenerating = true
        html2canvas(plot, { height, width }).then(
            (canvas) => {
                postMessageToHost('thumbnail', canvas.toDataURL('png'))
                if (interval) {
                    clearInterval(interval)
                }
                isGenerating = false
            },
            (reason) => {
                isGenerating = false
                console.error('Error in generating thumbnail: ', reason)
            }
        )
    } else {
        console.error('Plot element has zero height or width. Cannot generate thumbnail.')
    }
}

function isPlotly() {
    return document.querySelector('#plot-element .plotly') !== null
}

function isSvgTag() {
    return document.querySelector('svg') !== null
}


const SAVE_PLOT_MESSAGE_TYPE = 'savePlot'
const REQUEST_SAVE_PLOT_TYPE = 'requestSavePlot'
const REQUEST_COPY_PLOT_TYPE = 'requestCopyPlot'
const COPY_FAILED_MESSAGE_TYPE = 'copyFailed'
const COPY_SUCCESS_MESSAGE_TYPE = 'copySuccess'

/**
 * Fires when a plot export request(save/copy) is received, sends a message to the host with
 * i.  The plot data url,
 * ii. The index of the plot.
 * @param {number} index
 */
function handlePlotSaveRequest(index) {
    let plot = getPlotElement()
    if (isPlotly()) {
        Plotly.Snapshot.toImage(plot, { format: 'svg' }).once('success', (url) => {
            const svg = decodeURIComponent(url).replace(/data:image\/svg\+xml,/, '')

            postMessageToHost(SAVE_PLOT_MESSAGE_TYPE, { svg, index })
        })
    } else if (isSvgTag()) {
        const svg = document.querySelector('svg').outerHTML

        postMessageToHost(SAVE_PLOT_MESSAGE_TYPE, { svg, index })
    } else {
        // e.g. Makie may display png images via a HTML mime type. If the plot pane content is a div (so we didn't have one of the image MIME types
        // that we wrap in <img> ourselves) we can check if there's a single <img> in there, and if so, continue the plot saving logic with that.
        const innerPlot = getSingleImgFromHtmlContent(plot);
        if (innerPlot !== null){
            plot = innerPlot;
        }

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

function getSingleImgFromHtmlContent(el){
    if (el.tagName.toLowerCase() === "div") {
        const child = el.children.length === 1 ? el.children[0] : undefined;
        if (child && child.tagName.toLowerCase() === "img") {
            return child;
        }
    }
    return null
}

function handlePlotCopyRequest() {
    const plot = document.querySelector('svg') || getPlotElement()
    const isSvg = document.querySelector('svg') !== null

    const width = plot.offsetWidth
    const height = plot.offsetHeight

    if (!document.hasFocus()) {
        postMessageToHost(COPY_FAILED_MESSAGE_TYPE, 'Plot pane does not have focus.')
        return
    }

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
                ]).then(() => {
                    postMessageToHost(COPY_SUCCESS_MESSAGE_TYPE)
                }).catch(err => {
                    postMessageToHost(COPY_FAILED_MESSAGE_TYPE, err)
                })
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
                    ]).then(() => {
                        postMessageToHost(COPY_SUCCESS_MESSAGE_TYPE)
                    }).catch(err => {
                        postMessageToHost(COPY_FAILED_MESSAGE_TYPE, err)
                    })
                })
            },
            (reason) => {
                postMessageToHost(COPY_FAILED_MESSAGE_TYPE, reason)
                console.error(new Error(reason))
            }
        )
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

function initPanZoom() {
    if (panzoom) {
        const plot = getPlotElement()
        const instance = panzoom(plot, {
            smoothScroll: false,
            // disable keyboard event handling
            filterKey() {
                return true
            },
            beforeMouseDown(ev) {
                return !ev.altKey
            },
            beforeWheel(ev) {
                return !ev.altKey
            }
        })

        instance.on('zoom', function (instance) {
            const { scale } = instance.getTransform()
            if (scale > 2) {
                plot.classList.add('pixelated')
            } else {
                plot.classList.remove('pixelated')
            }
        })

        const resetZoomAndPan = ev => {
            if (ev && !ev.altKey) {
                return
            }
            instance.moveTo(0, 0)
            instance.zoomAbs(0, 0, 1)
            if (ev) {
                ev.stopPropagation()
            }
        }
        plot.addEventListener('dblclick', ev => {
            resetZoomAndPan(ev)
            ev.stopPropagation()
        })
        document.addEventListener('dblclick', resetZoomAndPan)
        document.body.addEventListener('dblclick', resetZoomAndPan)

        let isMove = false
        document.body.addEventListener('keydown', ev => {
            if (ev.altKey) {
                isMove = true
                plot.classList.add('pan-zoom')
            }
        })
        document.body.addEventListener('keyup', ev => {
            if (isMove) {
                isMove = false
                plot.classList.remove('pan-zoom')
            }
        })
    }
}

window.addEventListener('load', () => {
    removePlotlyBuiltinExport()
    initPanZoom()
})

window.addEventListener('message', ({ data }) => {
    switch (data.type) {
    case REQUEST_SAVE_PLOT_TYPE:
        handlePlotSaveRequest(data.body.index)
        break
    case REQUEST_COPY_PLOT_TYPE:
        // according to https://stackoverflow.com/questions/77465342/how-do-i-ensure-that-the-website-has-focus-so-the-copy-to-clipboard-can-happen
        // `setTimeout` avoids that the focus check in handlePlotCopyRequest fails because
        // the browser doesn't give the document focus back quickly enough after the user clicks the button
        // triggering the clipboard interaction (which is only allowed with focus)
        setTimeout(handlePlotCopyRequest, 0);
        break
    default:
        console.error(new Error('Unknown plot request!'))
    }
})
