(function (P) {
  "use strict";

  class PixelRenderer extends EventTarget {
    constructor(outputCanvas, originalCanvas, media, state) {
      super();
      this.canvas = outputCanvas;
      this.context = outputCanvas.getContext("2d", { alpha: true });
      this.originalCanvas = originalCanvas;
      this.originalContext = originalCanvas.getContext("2d", { alpha: true });
      this.workCanvas = document.createElement("canvas");
      this.workContext = this.workCanvas.getContext("2d", { alpha: true, willReadFrequently: true });
      this.media = media;
      this.state = state;
      this.dirty = false;
      this.running = false;
      this.lastFrameAt = 0;
      this.boundTick = this.tick.bind(this);

      this.adaptivePaletteCache = null;
      this.transparencyState = null;
      this.transparencyChecks = 0;
      state.addEventListener("configchange", () => this.requestRender());
      media.addEventListener("loaded", (event) => {
        this.adaptivePaletteCache = null;
        this.transparencyChecks = 0;
        this.transparencyState = typeof event.detail.hasTransparency === "boolean"
          ? event.detail.hasTransparency
          : null;
        this.requestRender();
      });
      media.addEventListener("framechange", () => this.requestRender());
    }

    start() {
      if (this.running) return;
      this.running = true;
      requestAnimationFrame(this.boundTick);
    }

    requestRender() { this.dirty = true; }

    setTransparency(hasTransparency) {
      if (this.transparencyState === hasTransparency) return;
      this.transparencyState = hasTransparency;
      this.dispatchEvent(new CustomEvent("transparencychange", { detail: { hasTransparency } }));
    }

    renderOriginal(source, outputWidth, outputHeight, baseWidth, baseHeight, padding) {
      if (this.originalCanvas.hidden) return;
      const maxPreviewDimension = 2048;
      const ratio = Math.max(1, Math.max(outputWidth, outputHeight) / maxPreviewDimension);
      const width = Math.max(1, Math.round(outputWidth / ratio));
      const height = Math.max(1, Math.round(outputHeight / ratio));
      if (this.originalCanvas.width !== width || this.originalCanvas.height !== height) {
        this.originalCanvas.width = width;
        this.originalCanvas.height = height;
      }
      this.originalContext.clearRect(0, 0, width, height);
      this.originalContext.imageSmoothingEnabled = true;
      this.originalContext.imageSmoothingQuality = "high";
      this.originalContext.drawImage(
        source,
        padding / ratio,
        padding / ratio,
        baseWidth / ratio,
        baseHeight / ratio
      );
    }

    tick(timestamp) {
      if (!this.running) return;
      const info = this.media.info;
      const config = this.state.config;
      const interval = 1000 / config.fps;
      const dynamicFrame = info && info.dynamic && this.media.playing && timestamp - this.lastFrameAt >= interval;
      if (this.dirty || dynamicFrame) {
        try {
          this.render();
          this.dirty = false;
          this.lastFrameAt = timestamp;
        } catch (error) {
          this.dispatchEvent(new CustomEvent("rendererror", { detail: error }));
        }
      }
      requestAnimationFrame(this.boundTick);
    }

    render() {
      const source = this.media.getDrawable();
      const info = this.media.info;
      if (!source || !info || !info.width || !info.height) return;

      const config = this.state.config;
      const maxLogicalDimension = 2048;
      const maxOutputDimension = 4096;
      let lowWidth = Math.max(1, Math.min(512, Math.round(config.targetWidth)));
      let lowHeight = Math.max(1, Math.round(lowWidth * info.height / info.width));
      const oversizedRatio = Math.max(lowWidth, lowHeight) / maxLogicalDimension;
      if (oversizedRatio > 1) {
        lowWidth = Math.max(1, Math.round(lowWidth / oversizedRatio));
        lowHeight = Math.max(1, Math.round(lowHeight / oversizedRatio));
      }

      if (this.workCanvas.width !== lowWidth || this.workCanvas.height !== lowHeight) {
        this.workCanvas.width = lowWidth;
        this.workCanvas.height = lowHeight;
      }
      this.workContext.clearRect(0, 0, lowWidth, lowHeight);
      this.workContext.imageSmoothingEnabled = config.sampling === "smooth";
      this.workContext.imageSmoothingQuality = "high";
      this.workContext.drawImage(source, 0, 0, lowWidth, lowHeight);

      const adaptiveSize = P.getAdaptivePaletteSize(config.palette);
      let palette = P.getPalette(config.palette, config.customPalette);
      let imageData = null;
      if (adaptiveSize) {
        imageData = this.workContext.getImageData(0, 0, lowWidth, lowHeight);
        const cacheKey = [config.palette, lowWidth, lowHeight, config.sampling].join(":");
        if (!this.adaptivePaletteCache || this.adaptivePaletteCache.media !== info || this.adaptivePaletteCache.key !== cacheKey) {
          this.adaptivePaletteCache = {
            media: info,
            key: cacheKey,
            colors: P.extractAdaptivePalette(imageData, adaptiveSize)
          };
        }
        palette = this.adaptivePaletteCache.colors;
      }

      const videoFrameReady = info.kind !== "video" || source.readyState >= 2;
      const shouldInspectTransparency = videoFrameReady && (this.transparencyState === null || (
        info.kind === "video" && this.transparencyState === false && this.transparencyChecks < 30
      ));
      if (shouldInspectTransparency) {
        imageData = imageData || this.workContext.getImageData(0, 0, lowWidth, lowHeight);
        this.transparencyChecks += 1;
        const detected = P.hasTransparency(imageData);
        if (detected || this.transparencyState === null) this.setTransparency(detected);
      }
      const sourceHasTransparency = this.transparencyState === true;

      if (palette && palette.length >= 2) {
        imageData = imageData || this.workContext.getImageData(0, 0, lowWidth, lowHeight);
        P.applyPalette(imageData, lowWidth, lowHeight, palette, config.dither);
        this.workContext.putImageData(imageData, 0, 0);
      }

      const outlineThickness = sourceHasTransparency
        ? Math.max(0, Math.min(8, Math.round(Number(config.outlineThickness) || 0)))
        : 0;
      const requestedScale = Math.max(1, Math.min(8, Math.round(config.outputScale)));
      const safeScale = Math.max(1, Math.floor((maxOutputDimension - outlineThickness * 2) / Math.max(lowWidth, lowHeight)));
      const scale = Math.min(requestedScale, safeScale);
      const baseWidth = lowWidth * scale;
      const baseHeight = lowHeight * scale;
      const outputWidth = baseWidth + outlineThickness * 2;
      const outputHeight = baseHeight + outlineThickness * 2;
      this.renderOriginal(source, outputWidth, outputHeight, baseWidth, baseHeight, outlineThickness);

      if (this.canvas.width !== outputWidth || this.canvas.height !== outputHeight) {
        this.canvas.width = outputWidth;
        this.canvas.height = outputHeight;
      }
      this.context.clearRect(0, 0, outputWidth, outputHeight);
      this.context.imageSmoothingEnabled = false;
      if (outlineThickness > 0) {
        const themeColor = getComputedStyle(document.documentElement).getPropertyValue("--ink").trim();
        const outlineColor = P.hexToRgb(config.outlineColorMode === "custom" ? config.outlineColor : themeColor) || [21, 21, 21];
        P.drawPixelOutline(this.context, this.workCanvas, baseWidth, baseHeight, outlineColor, outlineThickness);
      } else {
        this.context.drawImage(this.workCanvas, 0, 0, baseWidth, baseHeight);
      }
      this.dispatchEvent(new CustomEvent("rendered", {
        detail: {
          lowWidth, lowHeight, outputWidth, outputHeight, scale, requestedScale,
          outlineThickness,
          paletteColors: palette ? palette.map(P.rgbToHex) : []
        }
      }));
    }
  }

  P.PixelRenderer = PixelRenderer;
})(window.Pixelator = window.Pixelator || {});
