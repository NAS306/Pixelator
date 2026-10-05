(function (P) {
  "use strict";

  const BAYER_4 = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5
  ];
  let preparedPaletteCache = null;

  function clamp(value) {
    return value < 0 ? 0 : value > 255 ? 255 : value;
  }

  function preparePalette(palette) {
    const key = palette.map((rgb) => rgb.join(",")).join("|");
    if (preparedPaletteCache && preparedPaletteCache.key === key) return preparedPaletteCache;
    preparedPaletteCache = {
      key,
      colors: palette.map((rgb) => ({ rgb, lab: P.rgbToOklab(rgb[0], rgb[1], rgb[2]) })),
      lookup: new Int16Array(64 * 64 * 64).fill(-1)
    };
    return preparedPaletteCache;
  }

  function nearestColor(r, g, b, palette) {
    const red = clamp(r) >> 2;
    const green = clamp(g) >> 2;
    const blue = clamp(b) >> 2;
    const lookupIndex = (red << 12) | (green << 6) | blue;
    const cachedIndex = palette.lookup[lookupIndex];
    if (cachedIndex >= 0) return palette.colors[cachedIndex].rgb;
    const source = P.rgbToOklab(red * 4 + 2, green * 4 + 2, blue * 4 + 2);
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < palette.colors.length; i += 1) {
      const candidate = palette.colors[i];
      const dL = source[0] - candidate.lab[0];
      const da = source[1] - candidate.lab[1];
      const db = source[2] - candidate.lab[2];
      const distance = 1.35 * dL * dL + da * da + db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    palette.lookup[lookupIndex] = bestIndex;
    return palette.colors[bestIndex].rgb;
  }

  function preservePaletteDetails(data, width, height, paletteSize) {
    if (width < 2 || height < 2) return;
    const source = new Uint8ClampedArray(data);
    const luminance = new Float32Array(width * height);
    for (let pixel = 0; pixel < luminance.length; pixel += 1) {
      const index = pixel * 4;
      luminance[pixel] = 0.2126 * source[index] + 0.7152 * source[index + 1] + 0.0722 * source[index + 2];
    }

    const detailStrength = paletteSize <= 4 ? 0.82 : paletteSize <= 8 ? 0.68 : paletteSize <= 16 ? 0.52 : 0.36;
    const saturation = paletteSize <= 16 ? 1.08 : 1.04;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixel = y * width + x;
        const index = pixel * 4;
        if (source[index + 3] < 8) continue;
        let neighborTotal = 0;
        let neighborCount = 0;
        if (x > 0 && source[index - 1] >= 8) { neighborTotal += luminance[pixel - 1]; neighborCount += 1; }
        if (x + 1 < width && source[index + 7] >= 8) { neighborTotal += luminance[pixel + 1]; neighborCount += 1; }
        if (y > 0 && source[index - width * 4 + 3] >= 8) { neighborTotal += luminance[pixel - width]; neighborCount += 1; }
        if (y + 1 < height && source[index + width * 4 + 3] >= 8) { neighborTotal += luminance[pixel + width]; neighborCount += 1; }
        const localDifference = neighborCount ? luminance[pixel] - neighborTotal / neighborCount : 0;
        const detail = Math.max(-24, Math.min(24, localDifference * detailStrength));
        for (let channel = 0; channel < 3; channel += 1) {
          const saturated = luminance[pixel] + (source[index + channel] - luminance[pixel]) * saturation;
          data[index + channel] = clamp(saturated + detail);
        }
      }
    }
  }

  function quantizeFlat(data, width, height, palette, orderedStrength) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        if (data[index + 3] < 8) continue;
        const offset = orderedStrength ? ((BAYER_4[(y & 3) * 4 + (x & 3)] / 15) - 0.5) * orderedStrength : 0;
        const color = nearestColor(
          clamp(data[index] + offset),
          clamp(data[index + 1] + offset),
          clamp(data[index + 2] + offset),
          palette
        );
        data[index] = color[0];
        data[index + 1] = color[1];
        data[index + 2] = color[2];
      }
    }
  }

  function addError(buffer, index, errorR, errorG, errorB, factor) {
    buffer[index] += errorR * factor;
    buffer[index + 1] += errorG * factor;
    buffer[index + 2] += errorB * factor;
  }

  function quantizeFloyd(data, width, height, palette) {
    const buffer = new Float32Array(width * height * 3);
    for (let pixel = 0, target = 0; pixel < data.length; pixel += 4, target += 3) {
      buffer[target] = data[pixel];
      buffer[target + 1] = data[pixel + 1];
      buffer[target + 2] = data[pixel + 2];
    }

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixelIndex = y * width + x;
        const dataIndex = pixelIndex * 4;
        const bufferIndex = pixelIndex * 3;
        if (data[dataIndex + 3] < 8) continue;

        const oldR = clamp(buffer[bufferIndex]);
        const oldG = clamp(buffer[bufferIndex + 1]);
        const oldB = clamp(buffer[bufferIndex + 2]);
        const color = nearestColor(oldR, oldG, oldB, palette);
        data[dataIndex] = color[0];
        data[dataIndex + 1] = color[1];
        data[dataIndex + 2] = color[2];

        const errorR = oldR - color[0];
        const errorG = oldG - color[1];
        const errorB = oldB - color[2];
        if (x + 1 < width) addError(buffer, bufferIndex + 3, errorR, errorG, errorB, 7 / 16);
        if (y + 1 < height) {
          if (x > 0) addError(buffer, bufferIndex + width * 3 - 3, errorR, errorG, errorB, 3 / 16);
          addError(buffer, bufferIndex + width * 3, errorR, errorG, errorB, 5 / 16);
          if (x + 1 < width) addError(buffer, bufferIndex + width * 3 + 3, errorR, errorG, errorB, 1 / 16);
        }
      }
    }
  }

  function orderedStrength(paletteSize) {
    return paletteSize <= 4 ? 34 : paletteSize <= 8 ? 25 : paletteSize <= 16 ? 15 : 0;
  }

  function applyPalette(imageData, width, height, palette, dither) {
    if (!palette || palette.length < 2) return imageData;
    preservePaletteDetails(imageData.data, width, height, palette.length);
    const prepared = preparePalette(palette);
    const mode = dither === "auto" ? (palette.length <= 16 ? "ordered" : "none") : dither;
    if (mode === "floyd") quantizeFloyd(imageData.data, width, height, prepared);
    else quantizeFlat(imageData.data, width, height, prepared, mode === "ordered" ? orderedStrength(palette.length) : 0);
    return imageData;
  }

  P.applyPalette = applyPalette;
})(window.Pixelator = window.Pixelator || {});
