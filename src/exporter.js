(function (P) {
  "use strict";

  function safeBaseName(name) {
    return String(name || "pixel-art")
      .replace(/\.[^.]+$/, "")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .trim() || "pixel-art";
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function createFocusPauseGate(onPause, onResume) {
    let paused = false;
    let waiters = [];
    let resumeTask = Promise.resolve();
    const pause = () => {
      if (paused) return;
      paused = true;
      Promise.resolve(onPause?.()).catch(() => {});
    };
    const resume = () => {
      if (!paused) return;
      paused = false;
      resumeTask = Promise.resolve(onResume?.()).catch(() => {}).finally(() => {
        const pending = waiters;
        waiters = [];
        pending.forEach((resolve) => resolve());
      });
    };
    const onVisibility = () => {
      if (document.hidden) pause();
      else if (document.hasFocus()) resume();
    };
    window.addEventListener("blur", pause);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", onVisibility);
    return {
      wait() {
        if (paused) return new Promise((resolve) => waiters.push(resolve));
        return resumeTask;
      },
      dispose() {
        window.removeEventListener("blur", pause);
        window.removeEventListener("focus", resume);
        document.removeEventListener("visibilitychange", onVisibility);
        waiters.forEach((resolve) => resolve());
        waiters = [];
      }
    };
  }

  function savePng(canvas, sourceName) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("PNG 파일을 만들지 못했습니다."));
          return;
        }
        saveBlob(blob, safeBaseName(sourceName) + "-pixelated.png");
        resolve();
      }, "image/png");
    });
  }

  function supportedWebmType() {
    const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function recordWebm(canvas, sourceName, options) {
    const { fps, durationSeconds, onProgress, completion, start, pauseSource, resumeSource, onSuspendChange } = options;
    if (!canvas.captureStream || typeof MediaRecorder === "undefined") {
      return Promise.reject(new Error("이 브라우저는 Canvas WebM 녹화를 지원하지 않습니다."));
    }
    return new Promise((resolve, reject) => {
      const stream = canvas.captureStream(fps);
      const chunks = [];
      let recorder;
      let failure = null;
      try {
        const mimeType = supportedWebmType();
        recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined);
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        reject(error);
        return;
      }

      const startedAt = performance.now();
      let timer = 0;
      let suspendedAt = 0;
      let suspendedTotal = 0;
      let isSuspended = false;
      const stop = () => {
        if (recorder.state !== "inactive") recorder.stop();
      };
      const fail = (error) => {
        failure = error instanceof Error ? error : new Error(String(error));
        stop();
      };
      recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.onerror = (event) => fail(event.error || new Error("녹화 중 오류가 발생했습니다."));
      recorder.onstop = () => {
        window.clearInterval(timer);
        focusGate.dispose();
        stream.getTracks().forEach((track) => track.stop());
        if (failure) {
          reject(failure);
          return;
        }
        const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
        saveBlob(blob, safeBaseName(sourceName) + "-pixelated.webm");
        onProgress?.(1);
        resolve();
      };
      recorder.start(250);
      const focusGate = createFocusPauseGate(
        () => {
          if (recorder.state !== "recording") return;
          isSuspended = true;
          suspendedAt = performance.now();
          pauseSource?.();
          recorder.pause();
          onSuspendChange?.(true);
        },
        async () => {
          if (!isSuspended) return;
          await resumeSource?.();
          if (recorder.state === "paused") recorder.resume();
          suspendedTotal += performance.now() - suspendedAt;
          isSuspended = false;
          onSuspendChange?.(false);
        }
      );
      timer = window.setInterval(() => {
        const currentPause = isSuspended ? performance.now() - suspendedAt : 0;
        const activeElapsed = performance.now() - startedAt - suspendedTotal - currentPause;
        const ratio = Math.min(1, activeElapsed / (durationSeconds * 1000));
        onProgress?.(ratio);
        if (!completion && ratio >= 1) stop();
        else if (completion && activeElapsed > durationSeconds * 1000 + 5000) fail(new Error("영상 종료를 기다리는 시간이 너무 깁니다."));
      }, 100);
      if (completion) Promise.resolve(completion).then(stop).catch(fail);
      if (start) Promise.resolve().then(start).catch(fail);
    });
  }

  P.Exporter = { safeBaseName, saveBlob, savePng, recordWebm, createFocusPauseGate };
})(window.Pixelator = window.Pixelator || {});
