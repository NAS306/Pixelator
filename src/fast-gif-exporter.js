(function (P) {
  "use strict";

  function canFastGifExport() {
    return Boolean(P.WebmFrameEncoder && P.WebmFrameEncoder.isAvailable());
  }

  async function exportGifWebm(canvas, sourceName, options) {
    if (!canFastGifExport()) throw new Error("빠른 GIF 내보내기를 지원하지 않는 브라우저입니다.");
    const fps = Math.max(1, Math.round(options.fps));
    const durationSeconds = Number(options.durationSeconds);
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height || !durationSeconds) throw new Error("GIF 내보내기 크기 또는 길이가 올바르지 않습니다.");

    const frameEncoder = await P.WebmFrameEncoder.create(width, height, fps);
    let suspendedAt = 0;
    let suspendedTotal = 0;
    let suspended = false;
    const startedAt = performance.now();
    const focusGate = P.Exporter.createFocusPauseGate(
      () => {
        suspended = true;
        suspendedAt = performance.now();
        options.onSuspendChange?.(true);
      },
      () => {
        suspendedTotal += performance.now() - suspendedAt;
        suspended = false;
        options.onSuspendChange?.(false);
      }
    );
    try {
      const outputFrameCount = Math.max(1, Math.ceil(durationSeconds * fps));
      const frameStarts = options.frameStarts;
      let sourceFrameIndex = -1;
      for (let outputIndex = 0; outputIndex < outputFrameCount; outputIndex += 1) {
        await focusGate.wait();
        const seconds = Math.min(durationSeconds, outputIndex / fps);
        let nextSourceIndex = 0;
        while (nextSourceIndex + 1 < frameStarts.length && frameStarts[nextSourceIndex + 1] <= seconds + 0.000001) {
          nextSourceIndex += 1;
        }
        if (nextSourceIndex !== sourceFrameIndex) {
          options.renderFrame(nextSourceIndex);
          sourceFrameIndex = nextSourceIndex;
        } else {
          options.renderCurrentFrame();
        }

        const timestamp = Math.round(outputIndex * 1_000_000 / fps);
        const remaining = Math.max(0, durationSeconds * 1_000_000 - timestamp);
        const frameDuration = Math.max(1, Math.min(Math.round(1_000_000 / fps), Math.round(remaining)));
        await frameEncoder.encodeCanvas(canvas, timestamp, frameDuration, outputIndex % Math.max(1, fps * 2) === 0);
        if (outputIndex % 4 === 3) await new Promise((resolve) => window.setTimeout(resolve, 0));
        options.onProgress?.((outputIndex + 1) / outputFrameCount);
      }
      const result = await frameEncoder.finish(durationSeconds);
      P.Exporter.saveBlob(
        result.blob,
        P.Exporter.safeBaseName(sourceName) + "-pixelated.webm"
      );
      const activeElapsed = performance.now() - startedAt - suspendedTotal - (suspended ? performance.now() - suspendedAt : 0);
      return { elapsedSeconds: activeElapsed / 1000, codecId: result.codecId };
    } finally {
      focusGate.dispose();
      frameEncoder.close();
    }
  }

  P.Exporter.canFastGifExport = canFastGifExport;
  P.Exporter.exportGifWebm = exportGifWebm;
})(window.Pixelator = window.Pixelator || {});
