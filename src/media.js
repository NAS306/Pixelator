(function (P) {
  "use strict";

  function emit(target, type, detail) {
    target.dispatchEvent(new CustomEvent(type, { detail }));
  }

  class MediaController extends EventTarget {
    constructor() {
      super();
      this.element = null;
      this.objectUrl = null;
      this.info = null;
      this.playing = false;
      this.gifPlayer = null;
    }

    dispose() {
      if (this.gifPlayer) this.gifPlayer.dispose();
      if (this.element && this.element.tagName === "VIDEO") {
        this.element.pause();
        this.element.removeAttribute("src");
        this.element.load();
      }
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      this.gifPlayer = null;
      this.element = null;
      this.objectUrl = null;
      this.info = null;
      this.playing = false;
    }

    load(file) {
      if (!file || (!file.type.startsWith("image/") && !file.type.startsWith("video/"))) {
        return Promise.reject(new Error("지원되는 이미지 또는 영상 파일을 선택해 주세요."));
      }
      this.dispose();
      this.objectUrl = URL.createObjectURL(file);
      if (file.type.startsWith("video/")) return this.loadVideo(file);
      if (file.type === "image/gif" || /\.gif$/i.test(file.name)) return this.loadGif(file);
      return this.loadImage(file);
    }

    async loadGif(file) {
      try {
        this.gifPlayer = await P.GifPlayer.fromFile(file);
      } catch (error) {
        throw new Error("GIF 프레임을 해석하지 못했습니다: " + error.message);
      }
      this.element = this.gifPlayer.canvas;
      this.playing = true;
      this.info = {
        file,
        name: file.name,
        kind: "gif",
        dynamic: true,
        width: this.gifPlayer.width,
        height: this.gifPlayer.height,
        duration: this.gifPlayer.duration,
        frameCount: this.gifPlayer.frameCount,
        hasTransparency: this.gifPlayer.hasTransparency
      };
      this.gifPlayer.addEventListener("framechange", (event) => {
        emit(this, "framechange", event.detail);
        emit(this, "timeupdate", event.detail);
      });
      this.gifPlayer.play();
      emit(this, "loaded", this.info);
      return this.info;
    }

    loadImage(file) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => {
          this.element = image;
          this.playing = false;
          this.info = {
            file,
            name: file.name,
            kind: "image",
            dynamic: false,
            width: image.naturalWidth,
            height: image.naturalHeight,
            duration: 0
          };
          emit(this, "loaded", this.info);
          resolve(this.info);
        };
        image.onerror = () => reject(new Error("이미지를 읽을 수 없습니다. 파일이 손상되지 않았는지 확인해 주세요."));
        image.src = this.objectUrl;
      });
    }

    loadVideo(file) {
      return new Promise((resolve, reject) => {
        const video = document.createElement("video");
        video.preload = "auto";
        video.playsInline = true;
        video.muted = true;
        video.addEventListener("loadeddata", () => {
          this.element = video;
          this.playing = false;
          this.info = {
            file,
            name: file.name,
            kind: "video",
            dynamic: true,
            width: video.videoWidth,
            height: video.videoHeight,
            duration: Number.isFinite(video.duration) ? video.duration : 0
          };
          emit(this, "loaded", this.info);
          resolve(this.info);
        }, { once: true });
        video.addEventListener("timeupdate", () => emit(this, "timeupdate", this.timeData()));
        video.addEventListener("play", () => { this.playing = true; emit(this, "playback", { playing: true }); });
        video.addEventListener("pause", () => { this.playing = false; emit(this, "playback", { playing: false }); });
        video.addEventListener("ended", () => { this.playing = false; emit(this, "playback", { playing: false }); });
        video.addEventListener("seeked", () => emit(this, "framechange", this.timeData()));
        video.addEventListener("error", () => reject(new Error("영상을 읽을 수 없거나 브라우저가 코덱을 지원하지 않습니다.")), { once: true });
        video.src = this.objectUrl;
      });
    }

    getDrawable() { return this.element; }
    isReady() { return Boolean(this.element && this.info); }

    timeData() {
      if (!this.info) return { current: 0, duration: 0 };
      if (this.info.kind === "gif") return this.gifPlayer.timeData();
      if (this.info.kind !== "video") return { current: 0, duration: 0 };
      return { current: this.element.currentTime || 0, duration: this.info.duration || 0 };
    }

    async play() {
      if (!this.info || !this.info.dynamic) return;
      if (this.info.kind === "video") await this.element.play();
      else {
        this.gifPlayer.play();
        this.playing = true;
        emit(this, "playback", { playing: true });
      }
    }

    pause() {
      if (!this.info || !this.info.dynamic) return;
      if (this.info.kind === "video") this.element.pause();
      else {
        this.gifPlayer.pause();
        this.playing = false;
        emit(this, "playback", { playing: false });
      }
    }

    toggle() { return this.playing ? (this.pause(), Promise.resolve()) : this.play(); }

    seek(ratio) {
      if (!this.info || !this.info.dynamic || !this.info.duration) return;
      const seconds = Math.max(0, Math.min(1, ratio)) * this.info.duration;
      if (this.info.kind === "gif") this.gifPlayer.seek(seconds);
      else this.element.currentTime = seconds;
    }

    playbackSnapshot() {
      return {
        playing: this.playing,
        currentTime: this.timeData().current
      };
    }

    gifExportData() {
      if (!this.info || this.info.kind !== "gif") return null;
      return {
        frameStarts: this.gifPlayer.frameStarts.slice(),
        frameCount: this.gifPlayer.frameCount,
        duration: this.gifPlayer.duration
      };
    }

    renderGifFrameForExport(index) {
      if (!this.info || this.info.kind !== "gif") return;
      const target = Math.max(0, Math.min(this.gifPlayer.frameCount - 1, Math.round(index)));
      if (target === 0 || this.gifPlayer.currentIndex > target) this.gifPlayer.renderFrame(0, target === 0);
      while (this.gifPlayer.currentIndex < target) {
        const next = this.gifPlayer.currentIndex + 1;
        this.gifPlayer.renderFrame(next, next === target);
      }
    }

    seekTo(seconds) {
      if (!this.info || !this.info.dynamic) return Promise.resolve();
      if (this.info.kind === "gif") {
        this.gifPlayer.seek(seconds);
        return Promise.resolve();
      }
      const video = this.element;
      const target = Math.max(0, Math.min(this.info.duration, Number(seconds) || 0));
      if (Math.abs((video.currentTime || 0) - target) < 0.01) {
        emit(this, "framechange", this.timeData());
        return Promise.resolve();
      }
      return new Promise((resolve, reject) => {
        const cleanup = () => {
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
        };
        const onSeeked = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error("영상의 시작 위치로 이동하지 못했습니다.")); };
        video.addEventListener("seeked", onSeeked, { once: true });
        video.addEventListener("error", onError, { once: true });
        video.currentTime = target;
      });
    }

    async prepareFullRecording() {
      if (!this.info || !this.info.dynamic || !this.info.duration) {
        throw new Error("미디어의 전체 재생 길이를 확인할 수 없습니다.");
      }
      this.pause();
      if (this.info.kind === "video") await this.seekTo(0);
      else {
        this.gifPlayer.restart();
      }
    }

    waitForVideoEnd() {
      if (!this.info || this.info.kind !== "video") return null;
      const video = this.element;
      return new Promise((resolve, reject) => {
        if (video.ended) {
          resolve();
          return;
        }
        const cleanup = () => {
          video.removeEventListener("ended", onEnded);
          video.removeEventListener("error", onError);
        };
        const onEnded = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error("전체 영상을 재생하는 중 오류가 발생했습니다.")); };
        video.addEventListener("ended", onEnded, { once: true });
        video.addEventListener("error", onError, { once: true });
      });
    }

    async restorePlayback(snapshot) {
      if (!snapshot || !this.info) return;
      this.pause();
      if (this.info.dynamic) await this.seekTo(snapshot.currentTime);
      if (snapshot.playing) await this.play();
    }
  }

  P.MediaController = MediaController;
})(window.Pixelator = window.Pixelator || {});
