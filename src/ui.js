(function (P) {
  "use strict";

  function byId(id) { return document.getElementById(id); }
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }
  function formatTime(seconds) {
    const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const minutes = Math.floor(safe / 60);
    const remainder = Math.floor(safe % 60);
    return String(minutes).padStart(2, "0") + ":" + String(remainder).padStart(2, "0");
  }
  function formatTimelineTime(seconds, duration) {
    const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    return duration > 0 && duration < 10 ? safe.toFixed(2) + "s" : formatTime(safe);
  }

  class PixelatorUI {
    constructor(state, media, renderer) {
      this.state = state;
      this.media = media;
      this.renderer = renderer;
      this.recording = false;
      this.comparisonEnabled = false;
      this.comparisonPosition = 50;
      this.refs = {
        fileInput: byId("fileInput"), dropZone: byId("dropZone"), dropOverlay: byId("dropOverlay"),
        previewCanvases: byId("previewCanvases"), originalPane: byId("originalPane"),
        originalCanvas: byId("originalCanvas"), outputCanvas: byId("outputCanvas"),
        emptyState: byId("emptyState"), fileMeta: byId("fileMeta"),
        fileName: byId("fileName"), fileDetails: byId("fileDetails"), playButton: byId("playButton"),
        playIcon: byId("playIcon"), timeline: byId("timeline"), timecode: byId("timecode"), compareButton: byId("compareButton"),
        compareSlider: byId("compareSlider"), compareDivider: byId("compareDivider"),
        renderStats: byId("renderStats"), resolutionPreset: byId("resolutionPreset"),
        customWidth: byId("customWidth"), samplingMode: byId("samplingMode"), outputScale: byId("outputScale"),
        paletteSelect: byId("paletteSelect"), paletteStrip: byId("paletteStrip"), customPaletteBox: byId("customPaletteBox"),
        customPalette: byId("customPalette"), paletteHelp: byId("paletteHelp"), ditherMode: byId("ditherMode"),
        outlineSection: byId("outlineSection"), animationSection: byId("animationSection"),
        outlineColorMode: byId("outlineColorMode"), outlineColor: byId("outlineColor"),
        outlineThickness: byId("outlineThickness"), renderFps: byId("renderFps"),
        downloadPng: byId("downloadPng"),
        recordWebm: byId("recordWebm"), resetSettings: byId("resetSettings"), settingsFieldset: byId("settingsFieldset"),
        statusMessage: byId("statusMessage"), recordProgress: byId("recordProgress"), recordProgressBar: byId("recordProgressBar")
      };
      this.bindEvents();
      this.writeConfig(state.config);
      this.updateSectionNumbers();
    }

    bindEvents() {
      const r = this.refs;
      r.fileInput.addEventListener("change", () => this.handleFiles(r.fileInput.files));
      ["dragenter", "dragover"].forEach((type) => r.dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        r.dropZone.classList.add("is-dragging");
      }));
      ["dragleave", "drop"].forEach((type) => r.dropZone.addEventListener(type, (event) => {
        event.preventDefault();
        if (type === "drop") this.handleFiles(event.dataTransfer.files);
        r.dropZone.classList.remove("is-dragging");
      }));

      r.resolutionPreset.addEventListener("change", () => {
        r.customWidth.disabled = r.resolutionPreset.value !== "custom";
        if (r.resolutionPreset.value !== "custom") r.customWidth.value = r.resolutionPreset.value;
        this.readConfig();
      });
      [r.customWidth, r.customPalette, r.outlineColor, r.outlineThickness].forEach((element) => element.addEventListener("input", () => this.readConfig()));
      [r.samplingMode, r.outputScale, r.paletteSelect, r.ditherMode, r.renderFps].forEach((element) => {
        element.addEventListener("change", () => this.readConfig());
      });
      r.outlineColorMode.addEventListener("change", () => {
        this.updateOutlineUI();
        this.readConfig();
      });
      r.paletteSelect.addEventListener("change", () => this.updatePaletteUI());
      r.playButton.addEventListener("click", () => this.media.toggle().catch((error) => this.setStatus(error.message, "error")));
      r.timeline.addEventListener("pointerdown", () => {
        if (this.media.playing) this.media.pause();
      });
      r.timeline.addEventListener("input", () => {
        if (this.media.playing) this.media.pause();
        this.media.seek(Number(r.timeline.value) / 1000);
      });
      r.compareButton.addEventListener("click", () => this.setComparison(!this.comparisonEnabled));
      r.compareSlider.addEventListener("input", () => this.updateComparisonPosition(Number(r.compareSlider.value)));
      r.downloadPng.addEventListener("click", () => this.downloadPng());
      r.recordWebm.addEventListener("click", () => this.recordWebm());
      r.resetSettings.addEventListener("click", () => this.state.resetConfig());

      this.state.addEventListener("configreset", (event) => {
        this.writeConfig(event.detail);
        this.setStatus("기본 설정으로 되돌렸습니다.");
      });
      this.media.addEventListener("loaded", (event) => this.onMediaLoaded(event.detail));
      this.media.addEventListener("playback", (event) => this.updatePlayback(event.detail.playing));
      this.media.addEventListener("timeupdate", (event) => this.updateTimeline(event.detail));
      this.renderer.addEventListener("rendered", (event) => this.onRendered(event.detail));
      this.renderer.addEventListener("transparencychange", (event) => {
        this.refs.outlineSection.hidden = !event.detail.hasTransparency;
        this.updateSectionNumbers();
      });
      this.renderer.addEventListener("rendererror", (event) => this.setStatus("렌더링 오류: " + event.detail.message, "error"));
      window.addEventListener("resize", () => this.positionCompareHandle());
    }

    async handleFiles(fileList) {
      if (this.recording) {
        this.setStatus("전체 녹화가 끝난 뒤 미디어를 교체할 수 있습니다.");
        return;
      }
      const file = fileList && fileList[0];
      if (!file) return;
      this.setStatus("미디어를 불러오는 중…");
      try {
        await this.media.load(file);
      } catch (error) {
        this.setStatus(error.message, "error");
      } finally {
        this.refs.fileInput.value = "";
      }
    }

    onMediaLoaded(info) {
      const r = this.refs;
      r.emptyState.hidden = true;
      r.previewCanvases.hidden = false;
      r.outputCanvas.hidden = false;
      r.fileMeta.hidden = false;
      r.fileName.textContent = info.name;
      const durationText = info.dynamic && info.duration ? " · " + this.formatDuration(info.duration) : "";
      r.fileDetails.textContent = info.width + " × " + info.height + " · " + formatBytes(info.file.size) + durationText;
      r.downloadPng.disabled = false;
      r.recordWebm.disabled = !info.dynamic || !info.duration;
      r.playButton.disabled = !info.dynamic;
      r.timeline.disabled = !info.dynamic;
      r.compareButton.disabled = false;
      r.timeline.value = "0";
      this.setComparison(this.comparisonEnabled);
      r.animationSection.hidden = !info.dynamic;
      r.outlineSection.hidden = info.hasTransparency !== true;
      this.updateSectionNumbers();
      this.updatePlayback(this.media.playing);
      this.updateTimeline({ current: 0, duration: info.duration, frameIndex: 0, frameCount: info.frameCount });
      if (info.dynamic && !info.duration) this.setStatus("재생 길이를 읽지 못해 전체 WebM 녹화를 사용할 수 없습니다.", "error");
      else this.setStatus(info.kind === "image" ? "이미지 변환이 완료되었습니다." : "재생 프레임을 실시간으로 변환합니다.", "success");
      this.renderer.requestRender();
    }

    onRendered(size) {
      const scaleText = size.scale === size.requestedScale ? size.scale + "×" : size.scale + "× SAFE";
      this.refs.renderStats.textContent = size.lowWidth + "×" + size.lowHeight + " PX · " + scaleText;
      if (P.getAdaptivePaletteSize(this.state.config.palette) && size.paletteColors.length) {
        this.paintPalette(size.paletteColors);
      }
      window.requestAnimationFrame(() => this.positionCompareHandle());
    }

    positionCompareHandle() {
      if (!this.media.info || this.refs.outputCanvas.hidden) return;
      const previewRect = this.refs.previewCanvases.getBoundingClientRect();
      const canvasRect = this.refs.outputCanvas.getBoundingClientRect();
      const top = Math.max(8, Math.round(canvasRect.top - previewRect.top + 8));
      this.refs.previewCanvases.style.setProperty("--compare-handle-top", top + "px");
    }

    readConfig() {
      const r = this.refs;
      const width = Math.max(8, Math.min(512, Number(r.customWidth.value) || 96));
      const paletteColors = P.parseCustomPalette(r.customPalette.value);
      if (r.paletteSelect.value === "custom") {
        const valid = paletteColors.length >= 2;
        r.paletteHelp.textContent = valid ? paletteColors.length + "개 색상을 사용합니다." : "유효한 HEX 색상을 2개 이상 입력하세요.";
        r.paletteHelp.style.color = valid ? "" : "#b3261e";
      }
      this.state.updateConfig({
        targetWidth: r.resolutionPreset.value === "custom" ? width : Number(r.resolutionPreset.value),
        resolutionPreset: r.resolutionPreset.value,
        outputScale: Number(r.outputScale.value),
        sampling: r.samplingMode.value,
        palette: r.paletteSelect.value,
        customPalette: r.customPalette.value,
        dither: r.ditherMode.value,
        outlineColorMode: r.outlineColorMode.value,
        outlineColor: r.outlineColor.value,
        outlineThickness: Math.max(0, Math.min(8, Math.round(Number(r.outlineThickness.value) || 0))),
        fps: Number(r.renderFps.value)
      });
      this.updatePaletteUI();
    }

    writeConfig(config) {
      const r = this.refs;
      r.resolutionPreset.value = config.resolutionPreset;
      r.customWidth.value = config.targetWidth;
      r.customWidth.disabled = config.resolutionPreset !== "custom";
      r.samplingMode.value = config.sampling;
      r.outputScale.value = String(config.outputScale);
      r.paletteSelect.value = config.palette;
      r.customPalette.value = config.customPalette;
      r.ditherMode.value = config.dither;
      r.outlineColorMode.value = config.outlineColorMode;
      r.outlineColor.value = config.outlineColor;
      r.outlineThickness.value = String(config.outlineThickness);
      r.renderFps.value = String(config.fps);
      this.updatePaletteUI();
      this.updateOutlineUI();
    }

    updateOutlineUI() {
      this.refs.outlineColor.disabled = this.refs.outlineColorMode.value !== "custom";
    }

    updateSectionNumbers() {
      const sections = [...document.querySelectorAll(".control-section:not([hidden])")];
      sections.forEach((section, index) => {
        const number = section.querySelector(".step-number");
        if (number) number.textContent = String(index + 1).padStart(2, "0");
      });
    }

    updatePaletteUI() {
      const r = this.refs;
      const id = r.paletteSelect.value;
      r.customPaletteBox.hidden = id !== "custom";
      r.paletteStrip.innerHTML = "";
      r.paletteStrip.classList.toggle("is-original", id === "original");
      r.paletteStrip.classList.toggle("is-adaptive", Boolean(P.getAdaptivePaletteSize(id)));
      const colors = P.getPaletteHex(id, r.customPalette.value);
      this.paintPalette(colors, Boolean(P.getAdaptivePaletteSize(id)));
    }

    paintPalette(colors, keepAdaptivePlaceholder) {
      const strip = this.refs.paletteStrip;
      strip.innerHTML = "";
      if (!keepAdaptivePlaceholder) strip.classList.remove("is-adaptive");
      colors.forEach((color) => {
        const swatch = document.createElement("span");
        swatch.style.backgroundColor = color;
        swatch.title = color;
        strip.appendChild(swatch);
      });
    }

    updatePlayback(playing) {
      this.refs.playIcon.textContent = playing ? "Ⅱ" : "▶";
      this.refs.playButton.setAttribute("aria-label", playing ? "일시정지" : "재생");
    }

    setComparison(enabled) {
      const r = this.refs;
      this.comparisonEnabled = Boolean(enabled && this.media.info);
      r.previewCanvases.classList.toggle("is-comparing", this.comparisonEnabled);
      r.originalPane.hidden = !this.comparisonEnabled;
      r.originalCanvas.hidden = !this.comparisonEnabled;
      r.compareSlider.hidden = !this.comparisonEnabled;
      r.compareDivider.hidden = !this.comparisonEnabled;
      r.compareButton.setAttribute("aria-pressed", String(this.comparisonEnabled));
      r.compareButton.textContent = this.comparisonEnabled ? "비교 종료" : "원본 비교";
      this.updateComparisonPosition(this.comparisonPosition);
      this.renderer.requestRender();
    }

    updateComparisonPosition(position) {
      this.comparisonPosition = Math.max(0, Math.min(100, Number(position) || 0));
      this.refs.compareSlider.value = String(this.comparisonPosition);
      this.refs.previewCanvases.style.setProperty("--compare-position", this.comparisonPosition + "%");
    }

    updateTimeline(time) {
      const duration = time.duration || 0;
      this.refs.timeline.value = duration ? String(Math.round((time.current / duration) * 1000)) : "0";
      const frameText = time.frameCount ? " · " + (time.frameIndex + 1) + "/" + time.frameCount + "F" : "";
      this.refs.timecode.textContent = formatTimelineTime(time.current, duration) + " / " + formatTimelineTime(duration, duration) + frameText;
    }

    setStatus(message, kind) {
      const element = this.refs.statusMessage;
      element.textContent = message;
      element.classList.toggle("is-error", kind === "error");
      element.classList.toggle("is-success", kind === "success");
    }

    formatDuration(seconds) {
      if (seconds < 60) return (Math.round(seconds * 10) / 10) + "초";
      return formatTime(seconds) + " (" + Math.round(seconds) + "초)";
    }

    async downloadPng() {
      if (!this.media.info) return;
      this.renderer.render();
      try {
        await P.Exporter.savePng(this.refs.outputCanvas, this.media.info.name);
        this.setStatus("PNG 파일을 저장했습니다.", "success");
      } catch (error) {
        this.setStatus(error.message, "error");
      }
    }

    async recordWebm() {
      if (!this.media.info || !this.media.info.dynamic || this.recording) return;
      const r = this.refs;
      const duration = this.media.info.duration;
      if (!Number.isFinite(duration) || duration <= 0) {
        this.setStatus("미디어의 전체 재생 길이를 확인할 수 없습니다.", "error");
        return;
      }
      const playbackSnapshot = this.media.playbackSnapshot();
      this.recording = true;
      r.settingsFieldset.disabled = true;
      r.fileInput.disabled = true;
      r.recordWebm.disabled = true;
      r.downloadPng.disabled = true;
      r.recordProgress.hidden = false;
      r.recordProgressBar.style.width = "0%";
      const wantsFastGif = this.media.info.kind === "gif" && P.Exporter.canFastGifExport();
      const setExportStatus = (paused, fast) => {
        if (paused) this.setStatus("창이 비활성화되어 내보내기를 일시 중지했습니다.");
        else if (fast) this.setStatus("GIF 빠른 내보내기를 진행 중입니다.");
        else this.setStatus("녹화를 재개했습니다. 창이 활성화된 동안만 진행됩니다.");
      };
      try {
        await this.media.prepareFullRecording();
        this.renderer.render();
        let fastResult = null;
        if (wantsFastGif) {
          this.setStatus("GIF 빠른 내보내기를 진행 중입니다.");
          try {
            const gifData = this.media.gifExportData();
            fastResult = await P.Exporter.exportGifWebm(r.outputCanvas, this.media.info.name, {
              fps: this.state.config.fps,
              durationSeconds: duration,
              frameStarts: gifData.frameStarts,
              renderFrame: (index) => {
                this.media.renderGifFrameForExport(index);
                this.renderer.render();
              },
              renderCurrentFrame: () => this.renderer.render(),
              onProgress: (ratio) => { r.recordProgressBar.style.width = Math.round(ratio * 100) + "%"; },
              onSuspendChange: (paused) => setExportStatus(paused, true)
            });
          } catch (fastError) {
            await this.media.prepareFullRecording();
            this.renderer.render();
            this.setStatus("빠른 인코더를 사용할 수 없어 1배속 녹화로 전환했습니다.");
          }
        }
        if (!fastResult) {
          if (!wantsFastGif) this.setStatus("전체 " + this.formatDuration(duration) + "를 녹화 중… 완료까지 같은 시간이 걸립니다.");
          const completion = this.media.info.kind === "video" ? this.media.waitForVideoEnd() : null;
          await P.Exporter.recordWebm(
            r.outputCanvas,
            this.media.info.name,
            {
              fps: this.state.config.fps,
              durationSeconds: duration,
              completion,
              start: () => this.media.play(),
              pauseSource: () => this.media.pause(),
              resumeSource: () => this.media.play(),
              onSuspendChange: (paused) => setExportStatus(paused, false),
              onProgress: (ratio) => { r.recordProgressBar.style.width = Math.round(ratio * 100) + "%"; }
            }
          );
        }
        const speedText = fastResult && fastResult.elapsedSeconds > 0
          ? " · " + Math.max(1, Math.round(duration / fastResult.elapsedSeconds * 10) / 10) + "배속 처리"
          : "";
        this.setStatus("WebM 파일을 저장했습니다." + speedText, "success");
      } catch (error) {
        this.setStatus(error.message || "녹화하지 못했습니다.", "error");
      } finally {
        try {
          await this.media.restorePlayback(playbackSnapshot);
        } catch (error) {
          this.setStatus("파일은 저장했지만 이전 재생 위치로 돌아가지 못했습니다.", "error");
        }
        this.recording = false;
        r.settingsFieldset.disabled = false;
        r.fileInput.disabled = false;
        r.recordWebm.disabled = !this.media.info || !this.media.info.duration;
        r.downloadPng.disabled = false;
        window.setTimeout(() => { if (!this.recording) r.recordProgress.hidden = true; }, 800);
      }
    }
  }

  P.PixelatorUI = PixelatorUI;
})(window.Pixelator = window.Pixelator || {});
