"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const port = process.argv[2];
if (!port) throw new Error("DevTools port is required");

async function evaluateAtWidth(webSocketUrl, expression, width, height) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timer = setTimeout(() => reject(new Error("DevTools response timed out")), 30000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Emulation.setDeviceMetricsOverride",
        params: { width, height, deviceScaleFactor: 1, mobile: width < 981 }
      }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id === 1) {
        socket.send(JSON.stringify({ id: 2, method: "Page.reload", params: { ignoreCache: true } }));
        return;
      }
      if (message.id === 2) {
        setTimeout(() => socket.send(JSON.stringify({
          id: 3,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true, awaitPromise: true }
        })), 350);
        return;
      }
      if (message.id !== 3) return;
      clearTimeout(timer);
      socket.close();
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result.result.value);
    });
    socket.addEventListener("error", () => reject(new Error("DevTools socket failed")));
  });
}

(async () => {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
  const page = targets.find((target) => target.type === "page" && target.url.startsWith("file:"));
  if (!page) throw new Error("Pixelator page target not found");
  const result = await evaluateAtWidth(page.webSocketDebuggerUrl, `(async () => {
    const input = document.getElementById("fileInput");
    const capturedDownloads = [];
    const nativeAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      capturedDownloads.push({ href: this.href, download: this.download });
    };
    const waitUntil = async (predicate, timeout = 3000) => {
      const deadline = performance.now() + timeout;
      while (!predicate() && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 30));
      return predicate();
    };
    const inspectWebm = async (blob) => {
      const videoUrl = URL.createObjectURL(blob);
      const video = document.createElement("video");
      video.preload = "auto";
      const metadataPromise = new Promise((resolve) => video.addEventListener("loadedmetadata", () => resolve(true), { once: true }));
      video.src = videoUrl;
      const metadataLoaded = await Promise.race([
        metadataPromise,
        new Promise((resolve) => setTimeout(() => resolve(false), 2000))
      ]);
      const sampleFrame = async (seconds) => {
        const seeked = new Promise((resolve) => video.addEventListener("seeked", resolve, { once: true }));
        video.currentTime = seconds;
        await Promise.race([seeked, new Promise((resolve) => setTimeout(resolve, 1500))]);
        const sampleCanvas = document.createElement("canvas");
        sampleCanvas.width = video.videoWidth;
        sampleCanvas.height = video.videoHeight;
        const context = sampleCanvas.getContext("2d");
        context.drawImage(video, 0, 0);
        const pixel = context.getImageData(0, 0, 1, 1).data;
        return pixel[0] + "," + pixel[1] + "," + pixel[2];
      };
      const decodedColors = metadataLoaded ? [await sampleFrame(0.25), await sampleFrame(1.25)] : [];
      const result = {
        metadataLoaded,
        duration: metadataLoaded ? video.duration : 0,
        decodedColors,
        decodedAnimated: new Set(decodedColors).size > 1
      };
      URL.revokeObjectURL(videoUrl);
      return result;
    };
    const transfer = new DataTransfer();
    transfer.items.add(new File([
      '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><defs><linearGradient id="g"><stop stop-color="#ff304c"/><stop offset=".5" stop-color="#35d07f"/><stop offset="1" stop-color="#315cff"/></linearGradient></defs><rect width="96" height="64" fill="url(#g)"/><rect x="8" y="8" width="24" height="48" fill="#11131a"/><circle cx="68" cy="32" r="19" fill="#ffe25d"/></svg>'
    ], "browser-smoke.svg", { type: "image/svg+xml" }));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await waitUntil(() => !document.getElementById("outputCanvas").hidden && document.getElementById("outputCanvas").width);
    const canvas = document.getElementById("outputCanvas");
    const imageRender = {
      fileName: document.getElementById("fileName").textContent,
      canvasHidden: canvas.hidden,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      stats: document.getElementById("renderStats").textContent,
      status: document.getElementById("statusMessage").textContent,
      outlineHidden: document.getElementById("outlineSection").hidden,
      animationHidden: document.getElementById("animationSection").hidden
    };
    const compareButton = document.getElementById("compareButton");
    compareButton.click();
    await waitUntil(() => document.getElementById("originalCanvas").width === canvas.width && !document.getElementById("originalPane").hidden);
    const originalRect = document.getElementById("originalPane").getBoundingClientRect();
    const resultRect = document.querySelector(".result-pane").getBoundingClientRect();
    const compareSlider = document.getElementById("compareSlider");
    compareSlider.value = "25";
    compareSlider.dispatchEvent(new Event("input", { bubbles: true }));
    const comparisonRect = document.getElementById("previewCanvases").getBoundingClientRect();
    const dividerRect = document.getElementById("compareDivider").getBoundingClientRect();
    const handleRect = document.querySelector("#compareDivider span").getBoundingClientRect();
    const outputRect = canvas.getBoundingClientRect();
    const imageComparison = {
      pressed: compareButton.getAttribute("aria-pressed") === "true",
      originalWidth: document.getElementById("originalCanvas").width,
      canvasSizesMatch: document.getElementById("originalCanvas").width === canvas.width && document.getElementById("originalCanvas").height === canvas.height,
      layersOverlap: Math.abs(originalRect.left - resultRect.left) < 1 && Math.abs(originalRect.right - resultRect.right) < 1,
      sliderValue: compareSlider.value,
      dividerRatio: Math.round(((dividerRect.left + dividerRect.width / 2 - comparisonRect.left) / comparisonRect.width) * 100),
      labelsVisible: getComputedStyle(document.querySelector(".preview-label")).display !== "none",
      handleVisible: !document.getElementById("compareDivider").hidden,
      handleAtImageTop: handleRect.top >= outputRect.top + 6 && handleRect.top <= outputRect.top + 12
    };
    compareButton.click();

    const paletteSelect = document.getElementById("paletteSelect");
    paletteSelect.value = "adaptive16";
    paletteSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await waitUntil(() => document.getElementById("paletteStrip").children.length >= 8);
    const outputPixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const uniqueColors = new Set();
    for (let index = 0; index < outputPixels.length; index += 4) {
      if (outputPixels[index + 3]) uniqueColors.add(outputPixels[index] + "," + outputPixels[index + 1] + "," + outputPixels[index + 2]);
    }
    const adaptiveRender = {
      swatches: document.getElementById("paletteStrip").children.length,
      uniqueColors: uniqueColors.size,
      dither: document.getElementById("ditherMode").value
    };
    const adaptivePreview = canvas.toDataURL("image/png");

    paletteSelect.value = "pico8";
    paletteSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    const fixedPixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    const fixedUniqueColors = new Set();
    for (let index = 0; index < fixedPixels.length; index += 4) {
      if (fixedPixels[index + 3]) fixedUniqueColors.add(fixedPixels[index] + "," + fixedPixels[index + 1] + "," + fixedPixels[index + 2]);
    }
    const fixedRender = { palette: paletteSelect.value, uniqueColors: fixedUniqueColors.size };
    const fixedPreview = canvas.toDataURL("image/png");

    paletteSelect.value = "custom";
    paletteSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    const controlPanel = document.querySelector(".control-panel");
    const customPaletteLayout = {
      visible: !document.getElementById("customPaletteBox").hidden,
      clientHeight: controlPanel.clientHeight,
      scrollHeight: controlPanel.scrollHeight,
      needsScroll: controlPanel.scrollHeight > controlPanel.clientHeight
    };

    paletteSelect.value = "original";
    paletteSelect.dispatchEvent(new Event("change", { bubbles: true }));
    const transparentTransfer = new DataTransfer();
    transparentTransfer.items.add(new File([
      '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect x="1" y="1" width="2" height="2" fill="#e54b32"/></svg>'
    ], "transparent-smoke.svg", { type: "image/svg+xml" }));
    input.files = transparentTransfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await waitUntil(() => document.getElementById("fileName").textContent === "transparent-smoke.svg" && !document.getElementById("outlineSection").hidden);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const outlinedWidth = canvas.width;
    const outlinedHeight = canvas.height;
    const outlineColorMode = document.getElementById("outlineColorMode");
    const outlineColor = document.getElementById("outlineColor");
    outlineColorMode.value = "custom";
    outlineColorMode.dispatchEvent(new Event("change", { bubbles: true }));
    outlineColor.value = "#123456";
    outlineColor.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const outlinedPixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let customOutlinePixels = 0;
    for (let index = 0; index < outlinedPixels.length; index += 4) {
      if (outlinedPixels[index] === 18 && outlinedPixels[index + 1] === 52 && outlinedPixels[index + 2] === 86 && outlinedPixels[index + 3] === 255) customOutlinePixels += 1;
    }
    const outlineThickness = document.getElementById("outlineThickness");
    outlineThickness.value = "0";
    outlineThickness.dispatchEvent(new Event("input", { bubbles: true }));
    await waitUntil(() => canvas.width === 384);
    const zeroThicknessWidth = canvas.width;
    const transparentUi = {
      outlineVisible: !document.getElementById("outlineSection").hidden,
      animationHidden: document.getElementById("animationSection").hidden,
      outlinedWidth,
      outlinedHeight,
      onePixelIsExact: outlinedWidth === 386 && outlinedHeight === 386,
      customColorEnabled: !outlineColor.disabled,
      customOutlinePixels,
      zeroThicknessWidth
    };
    outlineColorMode.value = "theme";
    outlineColorMode.dispatchEvent(new Event("change", { bubbles: true }));
    outlineThickness.value = "1";
    outlineThickness.dispatchEvent(new Event("input", { bubbles: true }));

    const gifBytes = new Uint8Array([
      0x47,0x49,0x46,0x38,0x39,0x61,0x01,0x00,0x01,0x00,0x80,0x00,0x00,0x00,0x00,0x00,0xff,0xff,0xff,
      0x21,0xf9,0x04,0x00,0x64,0x00,0x00,0x00,0x2c,0x00,0x00,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0x02,0x02,0x44,0x01,0x00,
      0x21,0xf9,0x04,0x00,0x64,0x00,0x00,0x00,0x2c,0x00,0x00,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0x02,0x02,0x4c,0x01,0x00,0x3b
    ]);
    const gifTransfer = new DataTransfer();
    gifTransfer.items.add(new File([gifBytes], "browser-smoke.gif", { type: "image/gif" }));
    input.files = gifTransfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await waitUntil(() => document.getElementById("fileName").textContent === "browser-smoke.gif");
    const recordButton = document.getElementById("recordWebm");
    compareButton.click();
    await waitUntil(() => {
      const original = document.getElementById("originalCanvas");
      if (original.hidden || canvas.width !== 384 || original.width !== canvas.width) return false;
      const pixel = original.getContext("2d").getImageData(0, 0, 1, 1).data;
      return (pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0) || (pixel[0] === 255 && pixel[1] === 255 && pixel[2] === 255);
    });
    const observedGifColors = new Set();
    const observedOriginalGifColors = new Set();
    const observedTimelineValues = new Set();
    const observationDeadline = performance.now() + 1300;
    while (performance.now() < observationDeadline) {
      const pixel = canvas.getContext("2d").getImageData(0, 0, 1, 1).data;
      const originalPixel = document.getElementById("originalCanvas").getContext("2d").getImageData(0, 0, 1, 1).data;
      observedGifColors.add(pixel[0] + "," + pixel[1] + "," + pixel[2]);
      observedOriginalGifColors.add(originalPixel[0] + "," + originalPixel[1] + "," + originalPixel[2]);
      observedTimelineValues.add(document.getElementById("timeline").value);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    document.getElementById("timeline").value = "800";
    document.getElementById("timeline").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    document.getElementById("timeline").dispatchEvent(new Event("input", { bubbles: true }));
    await waitUntil(() => {
      if (!document.getElementById("timecode").textContent.includes("2/2F")) return false;
      const pixel = canvas.getContext("2d").getImageData(0, 0, 1, 1).data;
      return pixel[0] === 255 && pixel[1] === 255 && pixel[2] === 255;
    });
    const soughtPixel = canvas.getContext("2d").getImageData(0, 0, 1, 1).data;
    const gifSeek = {
      timelineEnabled: !document.getElementById("timeline").disabled,
      progressMoved: observedTimelineValues.size > 1,
      timelineValue: document.getElementById("timeline").value,
      timecode: document.getElementById("timecode").textContent,
      pausedAutomatically: document.getElementById("playButton").getAttribute("aria-label") === "재생",
      selectedSecondFrame: soughtPixel[0] === 255 && soughtPixel[1] === 255 && soughtPixel[2] === 255
    };
    document.getElementById("playButton").click();
    const gifLoaded = {
      fileName: document.getElementById("fileName").textContent,
      details: document.getElementById("fileDetails").textContent,
      recordDisabled: recordButton.disabled,
      durationSelectorRemoved: !document.getElementById("recordDuration"),
      outlineHidden: document.getElementById("outlineSection").hidden,
      animationVisible: !document.getElementById("animationSection").hidden,
      observedColors: [...observedGifColors],
      originalObservedColors: [...observedOriginalGifColors],
      animated: observedGifColors.size > 1,
      originalAnimated: observedOriginalGifColors.size > 1,
      comparisonPressed: compareButton.getAttribute("aria-pressed") === "true"
    };
    const gifExportStartedAt = performance.now();
    recordButton.click();
    const recordingGifColors = new Set();
    const recordingDeadline = performance.now() + 4000;
    while (!document.getElementById("statusMessage").textContent.includes("WebM 파일을 저장했습니다") && performance.now() < recordingDeadline) {
      const pixel = canvas.getContext("2d").getImageData(0, 0, 1, 1).data;
      recordingGifColors.add(pixel[0] + "," + pixel[1] + "," + pixel[2]);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    const gifRecordingStatus = document.getElementById("statusMessage").textContent;
    const gifRecordingAnimated = recordingGifColors.size > 1;
    const gifExportElapsedMs = Math.round(performance.now() - gifExportStartedAt);
    const gifDownload = [...capturedDownloads].reverse().find((item) => item.download === "browser-smoke-pixelated.webm");
    let fastGifWebm = { captured: false };
    if (gifDownload) {
      const blob = await fetch(gifDownload.href).then((response) => response.blob());
      const inspection = await inspectWebm(blob);
      fastGifWebm = {
        captured: true,
        bytes: blob.size,
        ...inspection,
        fasterThanRealtime: gifExportElapsedMs < 1800,
        fastStatus: gifRecordingStatus.includes("배속 처리")
      };
    }

    const transparentGifBytes = gifBytes.slice();
    for (let index = 0; index < transparentGifBytes.length - 3; index += 1) {
      if (transparentGifBytes[index] === 0x21 && transparentGifBytes[index + 1] === 0xf9) transparentGifBytes[index + 3] = 0x01;
    }
    const transparentGifTransfer = new DataTransfer();
    transparentGifTransfer.items.add(new File([transparentGifBytes], "transparent-smoke.gif", { type: "image/gif" }));
    input.files = transparentGifTransfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await waitUntil(() => document.getElementById("fileName").textContent === "transparent-smoke.gif" && !document.getElementById("outlineSection").hidden && !document.getElementById("animationSection").hidden);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const transparentGifUi = {
      outlineVisible: !document.getElementById("outlineSection").hidden,
      animationVisible: !document.getElementById("animationSection").hidden,
      controlClientHeight: controlPanel.clientHeight,
      controlScrollHeight: controlPanel.scrollHeight,
      needsScroll: controlPanel.scrollHeight > controlPanel.clientHeight
    };

    const focusCanvas = document.createElement("canvas");
    focusCanvas.width = 4;
    focusCanvas.height = 4;
    focusCanvas.getContext("2d").fillRect(0, 0, 4, 4);
    let pauseCalls = 0;
    let resumeCalls = 0;
    const suspensionStates = [];
    const focusTestStartedAt = performance.now();
    const focusRecording = window.Pixelator.Exporter.recordWebm(focusCanvas, "focus-test", {
      fps: 12,
      durationSeconds: 0.3,
      pauseSource: () => { pauseCalls += 1; },
      resumeSource: () => { resumeCalls += 1; },
      onSuspendChange: (paused) => suspensionStates.push(paused)
    });
    setTimeout(() => window.dispatchEvent(new Event("blur")), 50);
    setTimeout(() => window.dispatchEvent(new Event("focus")), 250);
    await focusRecording;
    const focusPause = {
      pauseCalls,
      resumeCalls,
      suspensionStates,
      elapsedMs: Math.round(performance.now() - focusTestStartedAt),
      pauseExtendedRecording: performance.now() - focusTestStartedAt >= 450
    };
    HTMLAnchorElement.prototype.click = nativeAnchorClick;

    const viewport = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll("body *")].map((element) => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName, id: element.id, className: String(element.className), left: rect.left, right: rect.right, width: rect.width };
    }).filter((item) => item.right > viewport + 1 || item.left < -1).slice(0, 20);
    return {
      innerWidth,
      innerHeight,
      viewport,
      htmlScrollWidth: document.documentElement.scrollWidth,
      htmlScrollHeight: document.documentElement.scrollHeight,
      bodyScrollWidth: document.body.scrollWidth,
      bodyScrollHeight: document.body.scrollHeight,
      verticalLayout: {
        workspaceBottom: Math.round(document.querySelector(".workspace").getBoundingClientRect().bottom),
        controlsBottom: Math.round(document.querySelector(".control-panel").getBoundingClientRect().bottom),
        statusBottom: Math.round(document.getElementById("statusMessage").getBoundingClientRect().bottom),
        controlHeader: Math.round(document.querySelector(".control-header").getBoundingClientRect().height),
        sections: [...document.querySelectorAll(".control-section")].map((section) => Math.round(section.getBoundingClientRect().height)),
        actions: Math.round(document.querySelector(".actions").getBoundingClientRect().height),
        status: Math.round(document.getElementById("statusMessage").getBoundingClientRect().height)
      },
      offenders,
      imageRender,
      imageComparison,
      adaptiveRender,
      adaptivePreview,
      fixedRender,
      fixedPreview,
      customPaletteLayout,
      transparentUi,
      gifLoaded,
      gifSeek,
      gifRecordingStatus,
      gifExportElapsedMs,
      fastGifWebm,
      gifRecordingColors: [...recordingGifColors],
      gifRecordingAnimated,
      transparentGifUi,
      focusPause
    };
  })()`, Number(process.argv[3]) || 390, Number(process.argv[4]) || 844);
  if (result.adaptivePreview) {
    const previewPath = path.join(os.tmpdir(), "pixelator-adaptive-qa.png");
    fs.writeFileSync(previewPath, Buffer.from(result.adaptivePreview.split(",")[1], "base64"));
    result.adaptivePreview = previewPath;
  }
  if (result.fixedPreview) {
    const previewPath = path.join(os.tmpdir(), "pixelator-fixed-qa.png");
    fs.writeFileSync(previewPath, Buffer.from(result.fixedPreview.split(",")[1], "base64"));
    result.fixedPreview = previewPath;
  }
  console.log(JSON.stringify(result, null, 2));
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
