(function (P) {
  "use strict";

  const textEncoder = new TextEncoder();

  function concat(parts) {
    const length = parts.reduce((total, part) => total + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  function hexBytes(hex) {
    const clean = hex.replace(/\s/g, "");
    const bytes = new Uint8Array(clean.length / 2);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
    }
    return bytes;
  }

  function encodeSize(value) {
    const numeric = BigInt(value);
    let length = 1;
    while (length < 8 && numeric >= (1n << BigInt(7 * length)) - 1n) length += 1;
    const output = new Uint8Array(length);
    let remaining = numeric;
    for (let index = length - 1; index >= 0; index -= 1) {
      output[index] = Number(remaining & 255n);
      remaining >>= 8n;
    }
    output[0] |= 1 << (8 - length);
    return output;
  }

  function unsigned(value) {
    let numeric = BigInt(Math.max(0, Math.round(Number(value) || 0)));
    const bytes = [];
    do {
      bytes.unshift(Number(numeric & 255n));
      numeric >>= 8n;
    } while (numeric > 0n);
    return new Uint8Array(bytes);
  }

  function float64(value) {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, Number(value), false);
    return new Uint8Array(buffer);
  }

  function element(id, data) {
    return concat([hexBytes(id), encodeSize(data.length), data]);
  }

  function master(id, children) {
    return element(id, concat(children));
  }

  function text(id, value) { return element(id, textEncoder.encode(value)); }
  function integer(id, value) { return element(id, unsigned(value)); }

  function simpleBlock(chunk, clusterTimestampMs) {
    const timestampMs = Math.round(chunk.timestamp / 1000);
    const relative = timestampMs - clusterTimestampMs;
    const header = new Uint8Array(4);
    header[0] = 0x81;
    header[1] = (relative >> 8) & 255;
    header[2] = relative & 255;
    header[3] = chunk.type === "key" ? 0x80 : 0;
    return element("A3", concat([header, chunk.data]));
  }

  function buildClusters(chunks) {
    const clusters = [];
    let clusterTimestamp = 0;
    let blocks = [];
    const flush = () => {
      if (!blocks.length) return;
      clusters.push(master("1F43B675", [integer("E7", clusterTimestamp), ...blocks]));
      blocks = [];
    };

    chunks.forEach((chunk, index) => {
      const timestampMs = Math.round(chunk.timestamp / 1000);
      const relative = timestampMs - clusterTimestamp;
      if (index === 0 || relative > 30000 || (chunk.type === "key" && relative >= 5000)) {
        flush();
        clusterTimestamp = timestampMs;
      }
      blocks.push(simpleBlock(chunk, clusterTimestamp));
    });
    flush();
    return clusters;
  }

  function muxWebm(chunks, options) {
    if (!chunks.length) throw new Error("인코딩된 GIF 프레임이 없습니다.");
    const codecId = options.codecId === "V_VP9" ? "V_VP9" : "V_VP8";
    const ebml = master("1A45DFA3", [
      integer("4286", 1),
      integer("42F7", 1),
      integer("42F2", 4),
      integer("42F3", 8),
      text("4282", "webm"),
      integer("4287", 4),
      integer("4285", 2)
    ]);
    const info = master("1549A966", [
      integer("2AD7B1", 1000000),
      element("4489", float64(options.durationSeconds * 1000)),
      text("4D80", "Pixelator"),
      text("5741", "Pixelator")
    ]);
    const video = master("E0", [
      integer("B0", options.width),
      integer("BA", options.height)
    ]);
    const trackEntry = master("AE", [
      integer("D7", 1),
      integer("73C5", 1),
      integer("83", 1),
      integer("23E383", Math.round(1000000000 / options.fps)),
      text("86", codecId),
      video
    ]);
    const tracks = master("1654AE6B", [trackEntry]);
    const segment = master("18538067", [info, tracks, ...buildClusters(chunks)]);
    return concat([ebml, segment]);
  }

  P.muxWebm = muxWebm;
})(window.Pixelator = window.Pixelator || {});
