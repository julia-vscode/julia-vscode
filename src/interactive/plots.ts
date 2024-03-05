import * as fs from 'fs/promises'
import { homedir } from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import * as telemetry from '../telemetry'
import { registerCommand, setContext } from '../utils'
import { displayTable } from './tables'
import { JuliaKernel } from '../notebook/notebookKernel'

const c_juliaPlotPanelActiveContextKey = 'julia.plotpaneFocus'
const g_plots: Array<string> = new Array<string>()
let g_currentPlotIndex: number = 0
let g_plotPanel: vscode.WebviewPanel | undefined = undefined
let g_context: vscode.ExtensionContext = null
let g_plotNavigatorProvider: PlotNavigatorProvider = null

export function activate(context: vscode.ExtensionContext) {
    g_context = context

    g_plotNavigatorProvider = new PlotNavigatorProvider(context)

    context.subscriptions.push(
        registerCommand('language-julia.copy-plot', requestCopyPlot),
        registerCommand('language-julia.save-plot', requestExportPlot),
        registerCommand('language-julia.show-plotpane', showPlotPane),
        registerCommand('language-julia.plotpane-enable', enablePlotPane),
        registerCommand('language-julia.plotpane-disable', disablePlotPane),
        registerCommand('language-julia.plotpane-previous', plotPanePrev),
        registerCommand('language-julia.plotpane-next', plotPaneNext),
        registerCommand('language-julia.plotpane-first', plotPaneFirst),
        registerCommand('language-julia.plotpane-last', plotPaneLast),
        registerCommand('language-julia.plotpane-delete', plotPaneDel),
        registerCommand('language-julia.plotpane-delete-all', plotPaneDelAll),
        registerCommand('language-julia.show-plot-navigator', () => g_plotNavigatorProvider.showPlotNavigator()),
        vscode.window.registerWebviewViewProvider('julia-plot-navigator', g_plotNavigatorProvider)
    )
}

interface Plot {
    thumbnail_type: string;
    thumbnail_data: string;
    time: Date;
}

class PlotNavigatorProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView
    private plotsInfo?: Array<Plot>
    private context: vscode.ExtensionContext

    constructor(context: vscode.ExtensionContext) {
        this.plotsInfo = []
        this.context = context
    }

    resolveWebviewView(view: vscode.WebviewView, context: vscode.WebviewViewResolveContext) {
        this.view = view

        view.webview.options = {
            enableScripts: true,
            enableCommandUris: true
        }

        view.webview.onDidReceiveMessage(msg => {
            // msg.type could be used to determine messages
            switch (msg.type) {
            case 'toPlot': // switch current plot to plot at index (msg.value)
                if (msg.value >= 0 && msg.value <= g_plots.length - 1) {
                    g_currentPlotIndex = msg.value
                    updatePlotPane()
                }
                break
            default:
                console.error(`Unknown message type from WebView: ${msg.type}, value: ${msg.value}`)
            }

        })

        this.reloadPlotPane()
    }

    getWebviewHTML(innerHTML: string) {
        const extensionPath = this.context.extensionPath
        const plotterStylesheet = this.view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'libs', 'plotter', 'plotter.css')))
        const plotterJavaScript = this.view.webview.asWebviewUri(vscode.Uri.file(path.join(extensionPath, 'scripts', 'plots', 'panel_webview.js')))

        return `<html lang="en" class='theme--plotter'>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Julia Plots</title>
                <link href=${plotterStylesheet} rel="stylesheet" type="text/css">
            </head>
            <body style="padding: 10px 1em 1em 1em">
                ${innerHTML}
                <script src=${plotterJavaScript}></script>
            </body>
        </html>`
    }

    async showPlotNavigator() {
        if (this?.view?.show === undefined) {
            // this forces the webview to be resolved, but changes focus:
            await vscode.commands.executeCommand('julia-plot-navigator.focus')
        }
        this.view.show(true)
    }

    setPlotsInfo(set_func) {
        this.plotsInfo = set_func(this.plotsInfo)
        this.reloadPlotPane()
    }

    getPlotsInfo() {
        return this.plotsInfo
    }

    plotToThumbnail(plot: Plot, index: number) {
        let thumbnailHTML: string
        switch (plot.thumbnail_type) {
        case 'image':
            thumbnailHTML = `<div class="thumbnail" onclick="toPlot(${index})">
                    <img src="${plot.thumbnail_data}" alt="Plot ${index + 1}" />
                </div>`
            break
        default:
        case 'text': // This is a fallback which shows the index of the plot
            thumbnailHTML = `<div class="thumbnail" onclick="toPlot(${index})">
                Plot ${index + 1}
                <small class="float-right">${plot.time.toLocaleTimeString()}</small>
            </div>`
            break
        }
        return thumbnailHTML
    }

    reloadPlotPane() {
        if (!this.view) {
            return
        }

        let innerHTML: string
        if (this.plotsInfo.length > 0) {
            innerHTML = `<div>
                ${this.plotsInfo.map(this.plotToThumbnail).reverse().join('\n')}
            </div>`
        } else {
            innerHTML = `<p>Use Julia to plot and your plots will appear here.</p>`
        }

        this.setHTML(this.getWebviewHTML(innerHTML))
    }

    postMessageToWebview(message: any) {
        if (this.view) {
            this.view.webview.postMessage(message)
        }
    }

    setHTML(html: string) {
        if (this.view) {
            this.view.webview.html = html
        }
    }
}

function invalidator() {
    // VSCode tries to be smart and only does something if the webview HTML changed.
    // That means that our onload events aren't fired and you won't get a thumbnail
    // for repeated plots. Attaching a meaningless and random script snippet fixes that.
    return `<script>(function(){${Math.random()}})()</script>`
}

function getPlotPaneContent(webview: vscode.Webview) {
    if (g_plots.length === 0) {
        return `<html lang="en" style="padding:0;margin:0;">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Julia Plots</title>
            <style>
            body {
                width: 100vw;
                height: 100vh;
            }
            .logo {
                width: 100%;
                height: 100%;
                opacity: 0.1;
                background: var(--vscode-foreground);
                -webkit-mask: url(${webview.asWebviewUri(
        vscode.Uri.file(
            path.join(
                g_context.extensionPath,
                'images',
                'julia-dots.svg'
            )
        ))}) 50% 50% / 200px no-repeat;
            }
        </style>
        </head>
        <body style="padding:0;margin:0;">
            <div class="logo"></div>
        </body>
        </html>`
    } else {
        const screenShotScript = `<script src="${webview.asWebviewUri(
            vscode.Uri.file(
                path.join(
                    g_context.extensionPath,
                    'libs',
                    'html2canvas',
                    'html2canvas.min.js'
                )
            )
        )}"></script><script src="${webview.asWebviewUri(
            vscode.Uri.file(
                path.join(
                    g_context.extensionPath,
                    'libs',
                    'panzoom',
                    'panzoom.min.js'
                )
            )
        )}"></script><script src="${webview.asWebviewUri(
            vscode.Uri.file(
                path.join(
                    g_context.extensionPath,
                    'scripts',
                    'plots',
                    'main_plot_webview.js'
                )
            )
        )}"></script>`

        return g_plots[g_currentPlotIndex] + screenShotScript + invalidator()
    }
}

function plotPanelOnMessage(msg) {
    switch (msg.type) {
    case 'thumbnail':
        {
            const thumbnailData = msg.value
            g_plotNavigatorProvider?.setPlotsInfo((plotsInfo) => {
                plotsInfo[g_currentPlotIndex] = {
                    thumbnail_type: 'image',
                    thumbnail_data: thumbnailData,
                    time: new Date()
                }
                return plotsInfo
            })
        }
        break
    case 'savePlot':
        savePlot(msg.value)
        break
    case 'copyFailed':
        if (msg.value) {
            vscode.window.showWarningMessage('Failed to copy plot: ' + msg.value)
        } else {
            vscode.window.showWarningMessage('Unknown: Failed to copy plot.')
        }
        break
    case 'copySuccess':
        vscode.window.showInformationMessage('Plot copied to clipboard.')
    }
}

export function showPlotPane() {
    telemetry.traceEvent('command-showplotpane')
    const plotTitle = makeTitle()

    if (!g_plotPanel) {
        g_plotPanel = vscode.window.createWebviewPanel(
            'jlplotpane',
            plotTitle,
            {
                preserveFocus: true,
                viewColumn: g_context.globalState.get('juliaPlotPanelViewColumn', vscode.ViewColumn.Two)
            },
            {
                enableScripts: true
            }
        )

        const viewStateListener = g_plotPanel.onDidChangeViewState(({ webviewPanel }) => {
            g_context.globalState.update('juliaPlotPanelViewColumn', webviewPanel.viewColumn)
            setContext(c_juliaPlotPanelActiveContextKey, webviewPanel.active)
        })

        g_plotPanel.webview.html = getPlotPaneContent(g_plotPanel.webview)
        setContext(c_juliaPlotPanelActiveContextKey, true)

        const configListener = vscode.workspace.onDidChangeConfiguration(config => {
            if (config.affectsConfiguration('julia') && g_plotPanel) {
                g_plotPanel.title = makeTitle()
            }
        })
        // Reset when the current panel is closed
        g_plotPanel.onDidDispose(() => {
            configListener.dispose()
            viewStateListener.dispose()
            g_plotPanel = undefined
            setContext(c_juliaPlotPanelActiveContextKey, false)
        }, null, g_context.subscriptions)

        g_plotPanel.webview.onDidReceiveMessage(plotPanelOnMessage)
        if (!g_plotPanel.visible) {
            g_plotPanel.reveal(g_plotPanel.viewColumn, true)
        }
    } else {
        g_plotPanel.title = plotTitle
        g_plotPanel.webview.html = getPlotPaneContent(g_plotPanel.webview)
        if (!g_plotPanel.visible) {
            g_plotPanel.reveal(g_plotPanel.viewColumn, true)
        }
    }
}

function makeTitle() {
    let plotTitle = 'Julia Plots'
    if (vscode.workspace.getConfiguration('julia').get('usePlotPane')) {
        plotTitle += g_plots.length > 0 ? ` (${g_currentPlotIndex + 1}/${g_plots.length})` : ' (0/0)'
    } else {
        plotTitle += ' (disabled)'
    }
    return plotTitle
}

function enablePlotPane() {
    const conf = vscode.workspace.getConfiguration('julia')
    conf.update('usePlotPane', true, vscode.ConfigurationTarget.Global)
}

function disablePlotPane() {
    const conf = vscode.workspace.getConfiguration('julia')
    conf.update('usePlotPane', false, vscode.ConfigurationTarget.Global)
}

function updatePlotPane() {
    showPlotPane()
}

export function plotPanePrev() {
    telemetry.traceEvent('command-plotpaneprevious')

    if (g_currentPlotIndex > 0) {
        g_currentPlotIndex = g_currentPlotIndex - 1
        updatePlotPane()
    }
}

export function plotPaneNext() {
    telemetry.traceEvent('command-plotpanenext')

    if (g_currentPlotIndex < g_plots.length - 1) {
        g_currentPlotIndex = g_currentPlotIndex + 1
        updatePlotPane()
    }
}

export function plotPaneFirst() {
    telemetry.traceEvent('command-plotpanefirst')

    if (g_plots.length > 0) {
        g_currentPlotIndex = 0
        updatePlotPane()
    }
}

export function plotPaneLast() {
    telemetry.traceEvent('command-plotpanelast')
    if (g_plots.length > 0) {
        g_currentPlotIndex = g_plots.length - 1
        updatePlotPane()
    }
}

export function plotPaneDel() {
    telemetry.traceEvent('command-plotpanedelete')
    if (g_plots.length > 0) {
        g_plotNavigatorProvider?.setPlotsInfo(plotsInfo => {
            plotsInfo.splice(g_currentPlotIndex, 1)
            return plotsInfo
        })
        g_plots.splice(g_currentPlotIndex, 1)
        if (g_currentPlotIndex > g_plots.length - 1) {
            g_currentPlotIndex = g_plots.length - 1
        }
        updatePlotPane()
    }
}

export function plotPaneDelAll() {
    telemetry.traceEvent('command-plotpanedeleteall')
    g_plotNavigatorProvider?.setPlotsInfo(() => [])
    if (g_plots.length > 0) {
        g_plots.splice(0, g_plots.length)
        g_currentPlotIndex = 0
        updatePlotPane()
    }
}

const plotElementStyle = `
#plot-element {
    max-height: 100vh;
    max-width: 100vw;
    display: block;
    position: absolute;
    image-rendering: auto;
}

img#plot-element.pixelated {
    image-rendering: pixelated;
}

#plot-element.pan-zoom {
    cursor: all-scroll !important;
}

#plot-element > svg {
    height: 100%;
    width: 100%;
}
`

// wrap a source string with an <img> tag that shows the content
// scaled to fit the plot pane unless the plot pane is bigger than the image
function wrapImagelike(srcString: string) {
    const isSvg = srcString.includes('data:image/svg+xml')
    let svgTag = ''
    if (isSvg) {
        svgTag = decodeURIComponent(srcString).replace(/^data.*<\?xml version="1\.0" encoding="utf-8"\?>\n/i, '')
        svgTag = `<div id="plot-element">${svgTag}</div>`
    }

    return `<html lang="en" style="padding:0;margin:0;">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>Julia Plots</title>
            <style>
            ${plotElementStyle}
            </style>
        </head>
        <body style="padding:0;margin:0;">
            ${isSvg ? svgTag : `<img id= "plot-element" style = "max-height: 100vh; max-width: 100vw; display:block;" src = "${srcString}" >`}
        </body>
        </html>`
}

export function displayPlot(params: { kind: string, data: string }, kernel?: JuliaKernel) {
    const kind = params.kind
    const payload = params.data

    if (!(kind.startsWith('application/vnd.dataresource'))) {
        // We display a text thumbnail first just in case that JavaScript errors in the webview or did not successfully send out message and corrupt thumbnail indices.
        g_plotNavigatorProvider?.setPlotsInfo(plotsInfo => {
            plotsInfo.push({
                thumbnail_type: 'text',
                thumbnail_data: null,
                time: new Date()
            })
            return plotsInfo
        })
    }

    if (kind === 'image/svg+xml') {
        const has_xmlns_attribute = payload.includes('xmlns=')
        let plotPaneContent: string
        if (has_xmlns_attribute) {
            // the xmlns attribute has to be present for data:image/svg+xml to work (https://stackoverflow.com/questions/18467982)
            // encodeURIComponent is needed to replace all special characters from the SVG string
            // which could break the HTML
            plotPaneContent = wrapImagelike(`data:image/svg+xml,${encodeURIComponent(payload)}`)
        } else {
            // otherwise we just show the svg directly as it's not straightforward to scale it
            // correctly if it's not in an img tag
            plotPaneContent = payload
        }

        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'image/png') {
        const plotPaneContent = wrapImagelike(`data:image/png;base64,${payload}`)
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'image/gif') {
        const plotPaneContent = wrapImagelike(`data:image/gif;base64,${payload}`)
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'juliavscode/html') {
        g_currentPlotIndex = g_plots.push(payload) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.vegalite.v2+json') {
        showPlotPane()
        const uriPanZoom = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'panzoom', 'panzoom.min.js')))
        const uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')))
        const uriVegaLite = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-lite-2', 'vega-lite.min.js')))
        const uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-3', 'vega.min.js')))
        const plotPaneContent = `
            <html>
                <head>
                    <script src="${uriPanZoom}"></script>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaLite}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plot-element" style="position: absolute; max-width: 100%; max-height: 100vh; top: 0; left: 0;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                    ${plotElementStyle}
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega-lite",
                        actions: false,
                        renderer: "svg"
                    }
                    var spec = ${payload}
                    vegaEmbed('#plot-element', spec, opt);
                </script>
            </html>`
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.vegalite.v3+json') {
        showPlotPane()
        const uriPanZoom = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'panzoom', 'panzoom.min.js')))
        const uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')))
        const uriVegaLite = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-lite-3', 'vega-lite.min.js')))
        const uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-5', 'vega.min.js')))
        const plotPaneContent = `
            <html>
                <head>
                    <script src="${uriPanZoom}"></script>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaLite}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plot-element" style="position: absolute; max-width: 100%; max-height: 100vh; top: 0; left: 0;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                    ${plotElementStyle}
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega-lite",
                        actions: false,
                        renderer: "svg"
                    }
                    var spec = ${payload}
                    vegaEmbed('#plot-element', spec, opt);
                </script>
            </html>`
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.vegalite.v4+json') {
        showPlotPane()
        const uriPanZoom = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'panzoom', 'panzoom.min.js')))
        const uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')))
        const uriVegaLite = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-lite-4', 'vega-lite.min.js')))
        const uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-5', 'vega.min.js')))
        const plotPaneContent = `
            <html>
                <head>
                    <script src="${uriPanZoom}"></script>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaLite}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plot-element" style="position: absolute; max-width: 100%; max-height: 100vh; top: 0; left: 0;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                    ${plotElementStyle}
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega-lite",
                        actions: false,
                        renderer: "svg"
                    }
                    var spec = ${payload}
                    vegaEmbed('#plot-element', spec, opt);
                </script>
            </html>`
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.vegalite.v5+json') {
        showPlotPane()
        const uriPanZoom = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'panzoom', 'panzoom.min.js')))
        const uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')))
        const uriVegaLite = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-lite-5', 'vega-lite.min.js')))
        const uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-5', 'vega.min.js')))
        const plotPaneContent = `
            <html>
                <head>
                    <script src="${uriPanZoom}"></script>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaLite}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plot-element" style="position: absolute; max-width: 100%; max-height: 100vh; top: 0; left: 0;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                    ${plotElementStyle}
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega-lite",
                        actions: false,
                        renderer: "svg"
                    }
                    var spec = ${payload}
                    vegaEmbed('#plot-element', spec, opt);
                </script>
            </html>`
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.vega.v3+json') {
        showPlotPane()
        const uriPanZoom = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'panzoom', 'panzoom.min.js')))
        const uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')))
        const uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-3', 'vega.min.js')))
        const plotPaneContent = `
            <html>
                <head>
                    <script src="${uriPanZoom}"></script>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plot-element" style="position: absolute; max-width: 100%; max-height: 100vh; top: 0; left: 0;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                    ${plotElementStyle}
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega",
                        actions: false,
                        renderer: "svg"
                    }
                    var spec = ${payload}
                    vegaEmbed('#plot-element', spec, opt);
                </script>
            </html>`
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.vega.v4+json') {
        showPlotPane()
        const uriPanZoom = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'panzoom', 'panzoom.min.js')))
        const uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')))
        const uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-4', 'vega.min.js')))
        const plotPaneContent = `
            <html>
                <head>
                    <script src="${uriPanZoom}"></script>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plot-element" style="position: absolute; max-width: 100%; max-height: 100vh; top: 0; left: 0;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                    ${plotElementStyle}
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega",
                        actions: false,
                        renderer: "svg"
                    }
                    var spec = ${payload}
                    vegaEmbed('#plot-element', spec, opt);
                </script>
            </html>`
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.vega.v5+json') {
        showPlotPane()
        const uriPanZoom = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'panzoom', 'panzoom.min.js')))
        const uriVegaEmbed = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-embed', 'vega-embed.min.js')))
        const uriVega = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'vega-5', 'vega.min.js')))
        const plotPaneContent = `
            <html>
                <head>
                    <script src="${uriPanZoom}"></script>
                    <script src="${uriVega}"></script>
                    <script src="${uriVegaEmbed}"></script>
                </head>
                <body>
                    <div id="plot-element" style="position: absolute; max-width: 100%; max-height: 100vh; top: 0; left: 0;"></div>
                </body>
                <style media="screen">
                    .vega-actions a {
                        margin-right: 10px;
                        font-family: sans-serif;
                        font-size: x-small;
                        font-style: italic;
                    }
                    ${plotElementStyle}
                </style>
                <script type="text/javascript">
                    var opt = {
                        mode: "vega",
                        actions: false,
                        renderer: "svg"
                    }
                    var spec = ${payload}
                    vegaEmbed('#plot-element', spec, opt);
                </script>
            </html>`
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.plotly.v1+json') {
        showPlotPane()
        const uriPlotly = g_plotPanel.webview.asWebviewUri(vscode.Uri.file(path.join(g_context.extensionPath, 'libs', 'plotly', 'plotly.min.js')))
        const plotPaneContent = `
        <html>
        <head>
            <script src="${uriPlotly}"></script>
        </head>
        <body>
            <div id="plot-element" style="position: absolute; max-width: 100%; max-height: 100vh; top: 0; left: 0;"></div>
        </body>
        <script type="text/javascript">
            function onResize () {
                const update = {
                    width: window.innerWidth,
                    height: window.innerHeight
                }
                Plotly.relayout('plot-element', update)
            }
            const spec = ${payload};
            Plotly.newPlot('plot-element', spec.data, spec.layout);
            if (!(spec.layout.width || spec.layout.height)) {
                onResize()
                window.addEventListener('resize', onResize);
            }
        </script>
        </html>`
        g_currentPlotIndex = g_plots.push(plotPaneContent) - 1
        showPlotPane()
    }
    else if (kind === 'application/vnd.dataresource+json') {
        return displayTable(payload, g_context, false, kernel)
    }
    else if (kind === 'application/vnd.dataresource+lazy') {
        return displayTable(payload, g_context, true, kernel)
    }
    else {
        throw new Error()
    }

    if (vscode.workspace.getConfiguration('julia').get('focusPlotNavigator')) {
        g_plotNavigatorProvider?.showPlotNavigator()
    }
}

/**
 * Send export request(message) to the plot pane.
 */
function requestExportPlot() {
    g_plotPanel.webview.postMessage({
        type: 'requestSavePlot',
        body: { index: g_currentPlotIndex },
    })
}

async function requestCopyPlot() {
    g_plotPanel.reveal(g_plotPanel.viewColumn, false)
    g_plotPanel.webview.postMessage({
        type: 'requestCopyPlot',
        body: { index: g_currentPlotIndex },
    })
}

interface ExportedPlot {
  svg?: string;
  png?: string;
  gif?: string;
  index: number;
}

type FileLike = string | Buffer;
/**
 * Write svg file of the plot to the plots directory.
 * @param plot
 */
function savePlot(plot: ExportedPlot) {
    const plotName = `plot_${plot.index + 1}`

    if (plot.svg !== null) {
        const fileName = `${plotName}.svg`
        _writePlotFile(fileName, plot.svg)
    }
    else if (plot.png !== null) {
        const fileName = `${plotName}.png`
        const buffer = Buffer.from(plot.png, 'base64')
        _writePlotFile(fileName, buffer)
    }
    else if (plot.gif !== null) {
        const fileName = `${plotName}.gif`
        const buffer = Buffer.from(plot.gif, 'base64')
        _writePlotFile(fileName, buffer)
    }
    else {
        vscode.window.showWarningMessage('Failed to save plot, supported formats are svg, png, and gif.')
    }
}

/**
 * Write the plot file to disk.
 * @param fileName
 * @param data
 * @param encoding
 */
async function _writePlotFile(fileName: string, data: FileLike) {
    const rootPath = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0 ?
        vscode.workspace.workspaceFolders[0].uri?.fsPath : null
    // If the default `plots.path` isn't in `settings.json` use the root:
    const defaultPlotsDir: string = vscode.workspace.getConfiguration('julia').get('plots.path') ?? ''

    let plotsDirFullPath: string = null
    if (rootPath) {
        plotsDirFullPath = path.isAbsolute(defaultPlotsDir) ?
            defaultPlotsDir :
            path.join(rootPath, defaultPlotsDir)
    }

    try {
        let isFile = true
        try {
            await fs.access(plotsDirFullPath)
        } catch (err) {
            isFile = false
        }
        if (!isFile) {
            const action = await vscode.window.showWarningMessage('The default plot path does not exist.', 'Create', 'Change')
            if (action === 'Create') {
                await fs.mkdir(plotsDirFullPath, { recursive: true })
            } else if (action === 'Change') {
                vscode.commands.executeCommand('workbench.action.openSettings', 'julia.plots.path')
                return
            } else {
                plotsDirFullPath = homedir()
            }
        }
        const plotFileFullPath = path.join(plotsDirFullPath, fileName)
        vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(plotFileFullPath) }).then(saveURI => {
            if (saveURI) {
                fs.writeFile(saveURI.fsPath, data)
            }
        })
    } catch (e) {
        console.error(e)
        vscode.window.showWarningMessage('Failed to save plot.')
    }
}
