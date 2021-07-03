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

/**
 * Fires when a export request is received, sends a message to the host with
 * i.  The plot data url,
 * ii. The index of the plot.
 * @param {number} index
 */
function handleExportPlotRequest(index) {
  const plot = getPlotElement();
  const svg = decodeURIComponent(plot.src).replace(/data:image\/svg\+xml,/, "");

  postMessageToHost("exportPlot", { svg, index });
}

window.addEventListener("load", getImage);
window.addEventListener("message", ({ data }) => {
  if (data.type === "requestExportPlot")
    handleExportPlotRequest(data.body.index);
});

interval = setInterval(getImage, 1000);
