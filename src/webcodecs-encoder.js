(function (P) {
  "use strict";

  class WebmFrameEncoder {
    constructor(config, codecId, fps) {
      this.config = config;
      this.codecId = codecId;
      this.fps = fps;
      this.chunks = [];
      this.failure = null;
      this.encoder = new VideoEncoder({
        output: (chunk) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          this.chunks.push({
            type: chunk.type,
            timestamp: chunk.timestamp,
            duration: chunk.duration,
            data
          });
        },
        error: (error) => { this.failure = error; }
      });
      this.encoder.configure(config);
    }

    static isAvailable() {
      return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined" && typeof P.muxWebm === "function";
    }

    static async create(width, height, fps) {
      if (!WebmFrameEncoder.isAvailable()) throw new Error("WebCodecs 영상 인코더를 지원하지 않는 브라우저입니다.");
      const candidates = [
        { codec: "vp09.00.10.08", codecId: "V_VP9" },
        { codec: "vp8", codecId: "V_VP8" }
      ];
      for (const candidate of candidates) {
        const config = {
          codec: candidate.codec,
          width,
          height,
          bitrate: 6_000_000,
          framerate: fps,
          latencyMode: "quality",
          alpha: "discard"
        };
        try {
          const support = await VideoEncoder.isConfigSupported(config);
          if (support.supported) return new WebmFrameEncoder(support.config || config, candidate.codecId, fps);
        } catch (error) {
          // Try the next codec.
        }
      }
      throw new Error("이 브라우저에서 VP8·VP9 WebM 인코더를 사용할 수 없습니다.");
    }

    async encodeCanvas(canvas, timestamp, duration, keyFrame) {
      if (this.failure) throw this.failure;
      const frame = new VideoFrame(canvas, { timestamp, duration });
      this.encoder.encode(frame, { keyFrame });
      frame.close();
      if (this.encoder.encodeQueueSize > 8) await this.encoder.flush();
      if (this.failure) throw this.failure;
    }

    async finish(durationSeconds) {
      await this.encoder.flush();
      if (this.failure) throw this.failure;
      this.chunks.sort((a, b) => a.timestamp - b.timestamp);
      const bytes = P.muxWebm(this.chunks, {
        codecId: this.codecId,
        width: this.config.width,
        height: this.config.height,
        fps: this.fps,
        durationSeconds
      });
      return {
        blob: new Blob([bytes], { type: "video/webm" }),
        codecId: this.codecId,
        chunkCount: this.chunks.length
      };
    }

    close() {
      if (this.encoder.state !== "closed") this.encoder.close();
    }
  }

  P.WebmFrameEncoder = WebmFrameEncoder;
})(window.Pixelator = window.Pixelator || {});
