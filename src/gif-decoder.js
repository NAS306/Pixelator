(function (P) {
  "use strict";

  const DEFAULT_DELAY_MS = 100;
  const MAX_CANVAS_PIXELS = 16_777_216;
  const MAX_FRAME_PIXELS = 128_000_000;

  function readUint16(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
  }

  function readColorTable(bytes, offset, size) {
    if (offset + size * 3 > bytes.length) throw new Error("GIF 색상표가 손상되었습니다.");
    const colors = new Array(size);
    for (let index = 0; index < size; index += 1) {
      const cursor = offset + index * 3;
      colors[index] = [bytes[cursor], bytes[cursor + 1], bytes[cursor + 2]];
    }
    return { colors, offset: offset + size * 3 };
  }

  function readSubBlocks(bytes, start) {
    const chunks = [];
    let total = 0;
    let offset = start;
    while (offset < bytes.length) {
      const size = bytes[offset];
      offset += 1;
      if (size === 0) break;
      if (offset + size > bytes.length) throw new Error("GIF 데이터 블록이 손상되었습니다.");
      chunks.push(bytes.subarray(offset, offset + size));
      total += size;
      offset += size;
    }
    const data = new Uint8Array(total);
    let cursor = 0;
    for (const chunk of chunks) {
      data.set(chunk, cursor);
      cursor += chunk.length;
    }
    return { data, offset };
  }

  function decodeLzw(minCodeSize, data, pixelCount) {
    if (minCodeSize < 2 || minCodeSize > 8) throw new Error("지원되지 않는 GIF LZW 코드 크기입니다.");
    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;
    const prefix = new Uint16Array(4096);
    const suffix = new Uint8Array(4096);
    const stack = new Uint8Array(4097);
    const pixels = new Uint8Array(pixelCount);
    for (let index = 0; index < clearCode; index += 1) suffix[index] = index;

    let available = clearCode + 2;
    let oldCode = -1;
    let codeSize = minCodeSize + 1;
    let codeMask = (1 << codeSize) - 1;
    let datum = 0;
    let bits = 0;
    let dataIndex = 0;
    let pixelIndex = 0;
    let stackSize = 0;
    let first = 0;

    while (pixelIndex < pixelCount) {
      if (stackSize === 0) {
        while (bits < codeSize) {
          if (dataIndex >= data.length) return pixels;
          datum |= data[dataIndex] << bits;
          bits += 8;
          dataIndex += 1;
        }

        let code = datum & codeMask;
        datum >>>= codeSize;
        bits -= codeSize;
        if (code === clearCode) {
          codeSize = minCodeSize + 1;
          codeMask = (1 << codeSize) - 1;
          available = clearCode + 2;
          oldCode = -1;
          continue;
        }
        if (code === endCode) break;
        if (oldCode < 0) {
          pixels[pixelIndex] = suffix[code];
          pixelIndex += 1;
          first = code;
          oldCode = code;
          continue;
        }

        const inputCode = code;
        if (code >= available) {
          stack[stackSize] = first;
          stackSize += 1;
          code = oldCode;
        }
        let guard = 0;
        while (code >= clearCode && guard < 4096) {
          stack[stackSize] = suffix[code];
          stackSize += 1;
          code = prefix[code];
          guard += 1;
        }
        first = suffix[code];
        stack[stackSize] = first;
        stackSize += 1;

        if (available < 4096) {
          prefix[available] = oldCode;
          suffix[available] = first;
          available += 1;
          if ((available & codeMask) === 0 && available < 4096) {
            codeSize += 1;
            codeMask = (1 << codeSize) - 1;
          }
        }
        oldCode = inputCode;
      }

      stackSize -= 1;
      pixels[pixelIndex] = stack[stackSize];
      pixelIndex += 1;
    }
    return pixels;
  }

  function deinterlace(indices, width, height) {
    const result = new Uint8Array(indices.length);
    const starts = [0, 4, 2, 1];
    const steps = [8, 8, 4, 2];
    let sourceRow = 0;
    for (let pass = 0; pass < 4; pass += 1) {
      for (let targetRow = starts[pass]; targetRow < height; targetRow += steps[pass]) {
        result.set(indices.subarray(sourceRow * width, (sourceRow + 1) * width), targetRow * width);
        sourceRow += 1;
      }
    }
    return result;
  }

  function decodeGif(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length < 13) throw new Error("GIF 헤더가 너무 짧습니다.");
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    if (signature !== "GIF87a" && signature !== "GIF89a") throw new Error("유효한 GIF 파일이 아닙니다.");

    const width = readUint16(bytes, 6);
    const height = readUint16(bytes, 8);
    if (!width || !height || width * height > MAX_CANVAS_PIXELS) throw new Error("GIF 해상도가 너무 큽니다.");
    const screenPacked = bytes[10];
    const backgroundIndex = bytes[11];
    let offset = 13;
    let globalPalette = null;
    if (screenPacked & 0x80) {
      const table = readColorTable(bytes, offset, 1 << ((screenPacked & 0x07) + 1));
      globalPalette = table.colors;
      offset = table.offset;
    }

    const frames = [];
    let totalFramePixels = 0;
    let graphicControl = { delayMs: DEFAULT_DELAY_MS, disposal: 0, transparentIndex: null };
    while (offset < bytes.length) {
      const marker = bytes[offset];
      if (marker === 0x3b) break;

      if (marker === 0x21) {
        const label = bytes[offset + 1];
        if (label === 0xf9 && bytes[offset + 2] >= 4 && offset + 7 < bytes.length) {
          const packed = bytes[offset + 3];
          const delayCs = readUint16(bytes, offset + 4);
          graphicControl = {
            delayMs: delayCs <= 1 ? DEFAULT_DELAY_MS : delayCs * 10,
            disposal: (packed >> 2) & 0x07,
            transparentIndex: packed & 0x01 ? bytes[offset + 6] : null
          };
          offset += 3 + bytes[offset + 2] + 1;
        } else {
          offset = readSubBlocks(bytes, offset + 2).offset;
        }
        continue;
      }

      if (marker === 0x2c && offset + 9 < bytes.length) {
        const left = readUint16(bytes, offset + 1);
        const top = readUint16(bytes, offset + 3);
        const frameWidth = readUint16(bytes, offset + 5);
        const frameHeight = readUint16(bytes, offset + 7);
        const imagePacked = bytes[offset + 9];
        if (!frameWidth || !frameHeight || left + frameWidth > width || top + frameHeight > height) {
          throw new Error("GIF 프레임 영역이 손상되었습니다.");
        }
        totalFramePixels += frameWidth * frameHeight;
        if (totalFramePixels > MAX_FRAME_PIXELS) throw new Error("GIF 프레임 데이터가 너무 큽니다.");

        offset += 10;
        let palette = globalPalette;
        if (imagePacked & 0x80) {
          const table = readColorTable(bytes, offset, 1 << ((imagePacked & 0x07) + 1));
          palette = table.colors;
          offset = table.offset;
        }
        if (!palette) throw new Error("GIF 프레임에 색상표가 없습니다.");
        const minCodeSize = bytes[offset];
        offset += 1;
        const blocks = readSubBlocks(bytes, offset);
        offset = blocks.offset;
        let indices = decodeLzw(minCodeSize, blocks.data, frameWidth * frameHeight);
        if (imagePacked & 0x40) indices = deinterlace(indices, frameWidth, frameHeight);
        frames.push({
          left,
          top,
          width: frameWidth,
          height: frameHeight,
          palette,
          indices,
          delayMs: graphicControl.delayMs,
          disposal: graphicControl.disposal,
          transparentIndex: graphicControl.transparentIndex
        });
        graphicControl = { delayMs: DEFAULT_DELAY_MS, disposal: 0, transparentIndex: null };
        continue;
      }
      offset += 1;
    }

    if (!frames.length) throw new Error("GIF에서 표시할 프레임을 찾지 못했습니다.");
    const transparent = frames.some((frame) => frame.transparentIndex !== null);
    const backgroundColor = !transparent && globalPalette && globalPalette[backgroundIndex]
      ? [...globalPalette[backgroundIndex], 255]
      : [0, 0, 0, 0];
    return {
      width,
      height,
      frames,
      frameCount: frames.length,
      duration: frames.reduce((total, frame) => total + frame.delayMs, 0) / 1000,
      hasTransparency: transparent,
      backgroundColor
    };
  }

  class GifPlayer extends EventTarget {
    constructor(decoded) {
      super();
      this.width = decoded.width;
      this.height = decoded.height;
      this.frames = decoded.frames;
      this.duration = decoded.duration;
      this.frameCount = decoded.frameCount;
      this.hasTransparency = decoded.hasTransparency;
      this.backgroundColor = decoded.backgroundColor;
      this.canvas = document.createElement("canvas");
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      this.context = this.canvas.getContext("2d", { alpha: true });
      this.imageData = this.context.createImageData(this.width, this.height);
      this.screen = new Uint8ClampedArray(this.width * this.height * 4);
      this.frameStarts = [];
      let elapsedMs = 0;
      for (const frame of this.frames) {
        this.frameStarts.push(elapsedMs / 1000);
        elapsedMs += frame.delayMs;
      }
      this.currentIndex = 0;
      this.previousFrame = null;
      this.previousRestore = null;
      this.playing = false;
      this.timer = 0;
      this.renderFrame(0);
    }

    static async fromFile(file) {
      return new GifPlayer(decodeGif(await file.arrayBuffer()));
    }

    fillScreen(color) {
      for (let index = 0; index < this.screen.length; index += 4) {
        this.screen[index] = color[0];
        this.screen[index + 1] = color[1];
        this.screen[index + 2] = color[2];
        this.screen[index + 3] = color[3];
      }
    }

    clearFrameArea(frame) {
      for (let y = 0; y < frame.height; y += 1) {
        for (let x = 0; x < frame.width; x += 1) {
          const target = ((frame.top + y) * this.width + frame.left + x) * 4;
          this.screen[target] = this.backgroundColor[0];
          this.screen[target + 1] = this.backgroundColor[1];
          this.screen[target + 2] = this.backgroundColor[2];
          this.screen[target + 3] = this.backgroundColor[3];
        }
      }
    }

    resetScreen() {
      this.fillScreen(this.backgroundColor);
      this.previousFrame = null;
      this.previousRestore = null;
    }

    renderFrame(index, notify = true) {
      if (index === 0) this.resetScreen();
      else if (this.previousFrame) {
        if (this.previousFrame.disposal === 2) this.clearFrameArea(this.previousFrame);
        else if (this.previousFrame.disposal === 3 && this.previousRestore) this.screen.set(this.previousRestore);
      }

      const frame = this.frames[index];
      const restore = frame.disposal === 3 ? this.screen.slice() : null;
      for (let y = 0; y < frame.height; y += 1) {
        for (let x = 0; x < frame.width; x += 1) {
          const source = y * frame.width + x;
          const colorIndex = frame.indices[source];
          if (colorIndex === frame.transparentIndex) continue;
          const color = frame.palette[colorIndex];
          if (!color) continue;
          const target = ((frame.top + y) * this.width + frame.left + x) * 4;
          this.screen[target] = color[0];
          this.screen[target + 1] = color[1];
          this.screen[target + 2] = color[2];
          this.screen[target + 3] = 255;
        }
      }
      this.imageData.data.set(this.screen);
      this.context.putImageData(this.imageData, 0, 0);
      this.currentIndex = index;
      this.previousFrame = frame;
      this.previousRestore = restore;
      if (notify) this.dispatchEvent(new CustomEvent("framechange", { detail: this.timeData() }));
    }

    timeData() {
      return {
        current: this.frameStarts[this.currentIndex] || 0,
        duration: this.duration,
        frameIndex: this.currentIndex,
        frameCount: this.frameCount
      };
    }

    seek(seconds) {
      const wasPlaying = this.playing;
      this.pause();
      const target = Math.max(0, Math.min(Math.max(0, this.duration - 0.000001), Number(seconds) || 0));
      let targetIndex = 0;
      for (let index = 1; index < this.frameStarts.length; index += 1) {
        if (this.frameStarts[index] > target) break;
        targetIndex = index;
      }
      this.renderFrame(0, targetIndex === 0);
      for (let index = 1; index <= targetIndex; index += 1) {
        this.renderFrame(index, index === targetIndex);
      }
      if (wasPlaying) this.play();
    }

    scheduleNext() {
      if (!this.playing) return;
      const delay = this.frames[this.currentIndex].delayMs;
      this.timer = window.setTimeout(() => {
        if (!this.playing) return;
        this.renderFrame((this.currentIndex + 1) % this.frames.length);
        this.scheduleNext();
      }, delay);
    }

    play() {
      if (this.playing) return;
      this.playing = true;
      this.scheduleNext();
    }

    pause() {
      this.playing = false;
      window.clearTimeout(this.timer);
      this.timer = 0;
    }

    restart() {
      this.pause();
      this.renderFrame(0);
    }

    dispose() {
      this.pause();
      this.canvas.width = 0;
      this.canvas.height = 0;
      this.frames = [];
      this.frameStarts = [];
      this.screen = new Uint8ClampedArray(0);
    }
  }

  P.decodeGif = decodeGif;
  P.GifPlayer = GifPlayer;
})(window.Pixelator = window.Pixelator || {});
