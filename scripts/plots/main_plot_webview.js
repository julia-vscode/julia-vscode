const vscode = acquireVsCodeApi();

function postMessageToHost(type, value) {
  if (type) {
    vscode.postMessage({
      type,
      value,
    });
  }
}

function getPlotElement() {
  const plot_element = document.getElementById("plot-element");
  if (!plot_element) {
    return document.getElementsByTagName("body")[0];
  }

  const canvas = plot_element.getElementsByTagName("canvas")[0];
  return canvas ?? plot_element;
}

let interval;
function getImage() {
  const plot = getPlotElement();
  const width = plot.offsetWidth;
  const height = plot.offsetHeight;

  html2canvas(plot, { height, width }).then(
    (canvas) => {
      postMessageToHost("thumbnail", canvas.toDataURL("png"));
      clearInterval(interval);
    },
    (reason) => {
      console.error("Error in taking thumbnail: ", reason);
    }
  );
}

function isPlotly() {
  return document.querySelector("#plot-element .plotly") != null;
}

function isVega() {
  return document.querySelector("#plot-element.vega-embed") != null;
}

/**
 * Fires when a export request is received, sends a message to the host with
 * i.  The plot data url,
 * ii. The index of the plot.
 * @param {number} index
 */
function handleExportPlotRequest(index) {
  const EXPORT_PLOT_MESSAGE_TYPE = "exportPlot";
  const plot = getPlotElement();
  if (isPlotly()) {
    Plotly.Snapshot.toImage(plot, { format: "svg" }).once("success", (url) => {
      const svg = decodeURIComponent(url).replace(/data:image\/svg\+xml,/, "");

      postMessageToHost(EXPORT_PLOT_MESSAGE_TYPE, { svg, index });
    });
  } else if (isVega()) {
    const svg = document.querySelector("#plot-element svg").outerHTML;

    postMessageToHost(EXPORT_PLOT_MESSAGE_TYPE, { svg, index });
  } else {
    const { src } = plot;

    const svg = src.includes("image/svg")
      ? decodeURIComponent(src).replace(/data:image\/svg\+xml,/, "")
      : null;
    const png = src.includes("image/png")
      ? src.replace(/data:image\/png;base64,/, "")
      : null;
    const gif = src.includes("image/gif")
      ? src.replace(/data:image\/gif;base64,/, "")
      : null;

    postMessageToHost(EXPORT_PLOT_MESSAGE_TYPE, { svg, png, gif, index });
  }
}

window.addEventListener("load", getImage);
window.addEventListener("message", ({ data }) => {
  if (data.type === "requestExportPlot")
    handleExportPlotRequest(data.body.index);
});

interval = setInterval(getImage, 1000);
