import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
import JSZip from "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

const markdownInput = document.querySelector("#markdownInput");
const fileInput = document.querySelector("#fileInput");
const fileName = document.querySelector("#fileName");
const clearButton = document.querySelector("#clearButton");
const downloadSvgZipButton = document.querySelector("#downloadSvgZipButton");
const statusText = document.querySelector("#statusText");
const results = document.querySelector("#results");
const template = document.querySelector("#diagramTemplate");
const exportFontFamily = 'Arial, "Microsoft JhengHei", "PingFang TC", "Noto Sans CJK TC", sans-serif';
const exportPadding = 24;
let renderedDiagrams = [];
let renderTimer;
let renderRequestId = 0;

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "default",
  htmlLabels: false,
  themeVariables: {
    fontFamily: exportFontFamily,
  },
  flowchart: {
    htmlLabels: false,
  },
});

fileInput.addEventListener("change", async () => {
  clearTimeout(renderTimer);
  const [file] = fileInput.files;
  if (!file) {
    fileName.textContent = "No file selected";
    return;
  }

  fileName.textContent = `${file.name} (${formatBytes(file.size)})`;
  markdownInput.value = await file.text();
  await renderDiagrams();
});

markdownInput.addEventListener("input", scheduleRender);
downloadSvgZipButton.addEventListener("click", downloadSvgZip);

clearButton.addEventListener("click", () => {
  clearTimeout(renderTimer);
  renderRequestId++;
  markdownInput.value = "";
  fileInput.value = "";
  fileName.textContent = "No file selected";
  results.replaceChildren();
  renderedDiagrams = [];
  statusText.textContent = "No diagrams rendered yet.";
  setDownloadButtonsEnabled(false);
});

function scheduleRender() {
  clearTimeout(renderTimer);

  if (markdownInput.value.trim().length === 0) {
    renderRequestId++;
    results.replaceChildren();
    renderedDiagrams = [];
    statusText.textContent = "No diagrams rendered yet.";
    setDownloadButtonsEnabled(false);
    return;
  }

  statusText.textContent = "Waiting for input...";
  renderTimer = setTimeout(renderDiagrams, 450);
}

async function renderDiagrams() {
  const requestId = ++renderRequestId;
  const markdown = markdownInput.value;
  const diagrams = extractMermaidBlocks(markdown);

  results.replaceChildren();
  renderedDiagrams = [];
  setDownloadButtonsEnabled(false);

  if (diagrams.length === 0) {
    statusText.textContent = "No Mermaid fenced code blocks found.";
    results.append(createMessage("No diagrams found. Add Markdown code blocks that start with ```mermaid or ~~~mermaid."));
    return;
  }

  setBusy(true);
  statusText.textContent = `Rendering ${diagrams.length} diagram${diagrams.length === 1 ? "" : "s"}...`;

  try {
    for (const [index, diagram] of diagrams.entries()) {
      if (requestId !== renderRequestId) {
        return;
      }

      const card = await createDiagramCard(diagram, index);
      results.append(card);
    }

    if (requestId !== renderRequestId) {
      return;
    }

    setDownloadButtonsEnabled(renderedDiagrams.length > 0);
    statusText.textContent = `Rendered ${renderedDiagrams.length} of ${diagrams.length} diagram${diagrams.length === 1 ? "" : "s"}.`;
  } finally {
    if (requestId === renderRequestId) {
      setBusy(false);
    }
  }
}

async function createDiagramCard(diagram, index) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector(".diagram-card");
  const title = fragment.querySelector(".diagram-title");
  const meta = fragment.querySelector(".diagram-meta");
  const preview = fragment.querySelector(".diagram-preview");
  const source = fragment.querySelector("code");
  const svgButton = fragment.querySelector(".download-svg");
  const number = index + 1;
  const filename = `mermaid-diagram-${String(number).padStart(2, "0")}`;

  title.textContent = `Diagram ${number}`;
  meta.textContent = `Lines ${diagram.startLine}-${diagram.endLine}`;
  source.textContent = diagram.code;

  try {
    const renderId = `mermaid-diagram-${Date.now()}-${index}`;
    const { svg, bindFunctions } = await mermaid.render(renderId, diagram.code);

    preview.innerHTML = svg;
    bindFunctions?.(preview);

    const svgElement = preview.querySelector("svg");
    if (!svgElement) {
      throw new Error("This Mermaid diagram did not produce an SVG.");
    }

    const exportedDiagram = createExportedDiagram(filename, svgElement);
    renderedDiagrams.push(exportedDiagram);

    svgButton.addEventListener("click", () => downloadSvg(exportedDiagram.svg, `${filename}.svg`));
  } catch (error) {
    preview.replaceChildren(createMessage(getErrorMessage(error), "error"));
    svgButton.disabled = true;
  }

  return card;
}

function extractMermaidBlocks(markdown) {
  const blocks = [];
  const fencePattern = /^[ \t]{0,3}([`~]{3,})([^\r\n]*)\r?\n([\s\S]*?)\r?\n[ \t]{0,3}\1[ \t]*$/gm;
  let match;

  while ((match = fencePattern.exec(markdown)) !== null) {
    const [, , infoString, code] = match;
    const language = infoString.trim().split(/\s+/)[0]?.toLowerCase();

    if (language !== "mermaid") {
      continue;
    }

    const prefix = markdown.slice(0, match.index);
    const startLine = countLineBreaks(prefix) + 1;
    const codeStartLine = startLine + 1;
    const codeLineCount = countTextLines(code);

    blocks.push({
      code: code.trim(),
      startLine: codeStartLine,
      endLine: codeStartLine + Math.max(codeLineCount - 1, 0),
    });
  }

  return blocks;
}

function countLineBreaks(value) {
  return value.match(/\r\n|\r|\n/g)?.length || 0;
}

function countTextLines(value) {
  if (value.length === 0) {
    return 0;
  }

  return value.split(/\r\n|\r|\n/).length;
}

function downloadSvg(svg, filename) {
  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  downloadBlob(blob, filename);
}

async function downloadSvgZip() {
  if (renderedDiagrams.length === 0) {
    return;
  }

  setBusy(true);
  statusText.textContent = `Packaging ${renderedDiagrams.length} SVG file${renderedDiagrams.length === 1 ? "" : "s"}...`;

  try {
    const zip = new JSZip();

    for (const diagram of renderedDiagrams) {
      zip.file(`${diagram.filename}.svg`, diagram.svg);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    downloadBlob(zipBlob, "mermaid-diagrams-svg.zip");
    statusText.textContent = `Packaged ${renderedDiagrams.length} SVG file${renderedDiagrams.length === 1 ? "" : "s"} as ZIP.`;
  } catch (error) {
    statusText.textContent = getErrorMessage(error);
  } finally {
    setBusy(false);
  }
}

function createExportedDiagram(filename, svgElement) {
  const geometry = getSvgGeometry(svgElement);
  const clone = svgElement.cloneNode(true);

  inlineSvgStyles(svgElement, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(geometry.width));
  clone.setAttribute("height", String(geometry.height));
  clone.setAttribute("viewBox", `${geometry.x} ${geometry.y} ${geometry.width} ${geometry.height}`);
  clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
  clone.style.background = "#ffffff";
  clone.style.fontFamily = exportFontFamily;

  return {
    filename,
    svg: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`,
    width: geometry.width,
    height: geometry.height,
  };
}

function inlineSvgStyles(sourceSvg, targetSvg) {
  const sourceElements = [sourceSvg, ...sourceSvg.querySelectorAll("*")];
  const targetElements = [targetSvg, ...targetSvg.querySelectorAll("*")];
  const styleProperties = [
    "alignment-baseline",
    "baseline-shift",
    "clip-rule",
    "color",
    "dominant-baseline",
    "fill",
    "fill-opacity",
    "fill-rule",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "letter-spacing",
    "line-height",
    "marker-end",
    "marker-mid",
    "marker-start",
    "opacity",
    "paint-order",
    "shape-rendering",
    "stroke",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-opacity",
    "stroke-width",
    "text-anchor",
    "text-decoration",
    "visibility",
  ];

  sourceElements.forEach((sourceElement, index) => {
    const targetElement = targetElements[index];
    const computedStyle = window.getComputedStyle(sourceElement);
    const inlineStyle = styleProperties
      .map((property) => `${property}:${getExportStyleValue(sourceElement, computedStyle, property)}`)
      .join(";");

    targetElement.setAttribute("style", inlineStyle);

    if (targetElement.tagName.toLowerCase() === "text" || targetElement.tagName.toLowerCase() === "tspan") {
      targetElement.setAttribute("font-family", exportFontFamily);
      targetElement.setAttribute("fill", computedStyle.fill || "#000000");
    }
  });
}

function getExportStyleValue(sourceElement, computedStyle, property) {
  if (property === "font-family") {
    return exportFontFamily;
  }

  if (property.startsWith("marker-")) {
    const marker = sourceElement.getAttribute(property) || computedStyle.getPropertyValue(property);
    return normalizeLocalUrl(marker);
  }

  return computedStyle.getPropertyValue(property);
}

function normalizeLocalUrl(value) {
  return value.replace(/url\(["']?[^#"')]+#([^"')]+)["']?\)/g, "url(#$1)");
}

function getSvgGeometry(svgElement) {
  const viewBox = parseViewBox(svgElement.getAttribute("viewBox"));
  let box = viewBox;

  try {
    const bbox = svgElement.getBBox();
    if (bbox.width > 0 && bbox.height > 0) {
      box = bbox;
    }
  } catch {
    box = viewBox;
  }

  return {
    x: Math.floor(box.x - exportPadding),
    y: Math.floor(box.y - exportPadding),
    width: Math.ceil(box.width + exportPadding * 2),
    height: Math.ceil(box.height + exportPadding * 2),
  };
}

function parseViewBox(viewBox) {
  if (viewBox) {
    const [x, y, width, height] = viewBox.split(/[\s,]+/).map(Number);
    if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
      return { x, y, width, height };
    }
  }

  return { x: 0, y: 0, width: 1200, height: 800 };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function createMessage(message, type = "empty") {
  const element = document.createElement("div");
  element.className = type === "error" ? "error-state" : "empty-state";
  element.textContent = message;
  return element;
}

function setBusy(isBusy) {
  markdownInput.disabled = isBusy;
  fileInput.disabled = isBusy;
  setDownloadButtonsEnabled(!isBusy && renderedDiagrams.length > 0);
}

function setDownloadButtonsEnabled(isEnabled) {
  downloadSvgZipButton.disabled = !isEnabled;
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "This Mermaid diagram could not be rendered.";
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
