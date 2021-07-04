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

const EXPORT_PLOT_MESSAGE_TYPE = "exportPlot";
const COPY_PLOT_MESSAGE_TYPE = "copyPlot";
const REQUEST_EXPORT_PLOT_TYPE = "requestExportPlot";
const REQUEST_COPY_PLOT_TYPE = "requestCopyPlot";

/**
 * Fires when a export request is received, sends a message to the host with
 * i.  The plot data url,
 * ii. The index of the plot.
 * @param {number} index
 * @param { REQUEST_EXPORT_PLOT_TYPE | REQUEST_COPY_PLOT_TYPE} reqType
 */
function handlePlotRequest(index, reqType) {
  const plot = getPlotElement();
  if (isPlotly()) {
    Plotly.Snapshot.toImage(plot, { format: "svg" }).once("success", (url) => {
      const svg = decodeURIComponent(url).replace(/data:image\/svg\+xml,/, "");

      postMessageToHost(reqType, { svg, index });
    });
  } else if (isVega()) {
    const svg = document.querySelector("#plot-element svg").outerHTML;

    postMessageToHost(reqType, { svg, index });
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

    postMessageToHost(reqType, { svg, png, gif, index });
  }
}

window.addEventListener("load", getImage);
window.addEventListener("load", () => {
  // Remove Plotly builtin export button; it's nonfunctional in VSCode and can confuse users.
  document.querySelector(
    '[data-title="Download plot as a png"]'
  ).style.display = "none";
});

window.addEventListener("message", ({ data }) => {
  switch (data.type) {
    case REQUEST_EXPORT_PLOT_TYPE:
      handlePlotRequest(data.body.index, EXPORT_PLOT_MESSAGE_TYPE);
      break;
    case REQUEST_COPY_PLOT_TYPE:
      handlePlotRequest(data.body.index, COPY_PLOT_MESSAGE_TYPE);
      break;
    default:
      console.error(new Error("Unknown plot request!"));
  }
});

interval = setInterval(getImage, 1000);
