(function (P) {
  "use strict";

  const ADAPTIVE_SIZES = Object.freeze({ adaptive8: 8, adaptive16: 16, adaptive32: 32 });

  function getAdaptivePaletteSize(id) {
    return ADAPTIVE_SIZES[id] || 0;
  }

  function buildHistogram(imageData, maxSamples) {
    const data = imageData.data;
    const pixelCount = data.length / 4;
    const step = Math.max(1, Math.ceil(pixelCount / maxSamples));
    const histogram = new Map();
    for (let pixel = 0; pixel < pixelCount; pixel += step) {
      const index = pixel * 4;
      if (data[index + 3] < 32) continue;
      const key = ((data[index] >> 3) << 10) | ((data[index + 1] >> 3) << 5) | (data[index + 2] >> 3);
      let entry = histogram.get(key);
      if (!entry) {
        entry = { r: 0, g: 0, b: 0, count: 0 };
        histogram.set(key, entry);
      }
      entry.r += data[index];
      entry.g += data[index + 1];
      entry.b += data[index + 2];
      entry.count += 1;
    }
    return [...histogram.values()].map((entry) => {
      const r = entry.r / entry.count;
      const g = entry.g / entry.count;
      const b = entry.b / entry.count;
      return { r, g, b, count: entry.count, lab: P.rgbToOklab(r, g, b) };
    });
  }

  function describeBox(entries) {
    const minimum = [Infinity, Infinity, Infinity];
    const maximum = [-Infinity, -Infinity, -Infinity];
    let population = 0;
    for (const entry of entries) {
      for (let channel = 0; channel < 3; channel += 1) {
        minimum[channel] = Math.min(minimum[channel], entry.lab[channel]);
        maximum[channel] = Math.max(maximum[channel], entry.lab[channel]);
      }
      population += entry.count;
    }
    const ranges = maximum.map((value, channel) => value - minimum[channel]);
    const channel = ranges[0] >= ranges[1] && ranges[0] >= ranges[2] ? 0 : ranges[1] >= ranges[2] ? 1 : 2;
    return { entries, population, channel, score: ranges[channel] * Math.log2(population + 1) };
  }

  function splitBox(box) {
    const entries = box.entries.slice().sort((a, b) => a.lab[box.channel] - b.lab[box.channel]);
    let accumulated = 0;
    let splitAt = 1;
    const midpoint = box.population / 2;
    for (let index = 0; index < entries.length - 1; index += 1) {
      accumulated += entries[index].count;
      if (accumulated >= midpoint) {
        splitAt = index + 1;
        break;
      }
    }
    return [describeBox(entries.slice(0, splitAt)), describeBox(entries.slice(splitAt))];
  }

  function centroid(entries) {
    let red = 0;
    let green = 0;
    let blue = 0;
    let population = 0;
    for (const entry of entries) {
      red += entry.r * entry.count;
      green += entry.g * entry.count;
      blue += entry.b * entry.count;
      population += entry.count;
    }
    return [red / population, green / population, blue / population];
  }

  function labDistance(first, second) {
    const dL = first[0] - second[0];
    const da = first[1] - second[1];
    const db = first[2] - second[2];
    return 1.25 * dL * dL + da * da + db * db;
  }

  function refineCentroids(entries, colors) {
    let centroids = colors.map((rgb) => ({ rgb, lab: P.rgbToOklab(...rgb) }));
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const totals = centroids.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
      for (const entry of entries) {
        let bestIndex = 0;
        let bestDistance = Infinity;
        for (let index = 0; index < centroids.length; index += 1) {
          const distance = labDistance(entry.lab, centroids[index].lab);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = index;
          }
        }
        const total = totals[bestIndex];
        total.r += entry.r * entry.count;
        total.g += entry.g * entry.count;
        total.b += entry.b * entry.count;
        total.count += entry.count;
      }
      centroids = centroids.map((current, index) => {
        const total = totals[index];
        if (!total.count) return current;
        const rgb = [total.r / total.count, total.g / total.count, total.b / total.count];
        return { rgb, lab: P.rgbToOklab(...rgb) };
      });
    }
    return centroids.map((entry) => entry.rgb.map(Math.round));
  }

  function extractAdaptivePalette(imageData, requestedSize) {
    const targetSize = Math.max(2, Math.min(32, Math.round(requestedSize)));
    const entries = buildHistogram(imageData, 8192);
    if (!entries.length) return [[0, 0, 0], [255, 255, 255]];
    if (entries.length === 1) return [[Math.round(entries[0].r), Math.round(entries[0].g), Math.round(entries[0].b)]];

    const boxes = [describeBox(entries)];
    while (boxes.length < targetSize) {
      let candidate = -1;
      for (let index = 0; index < boxes.length; index += 1) {
        if (boxes[index].entries.length < 2) continue;
        if (candidate < 0 || boxes[index].score > boxes[candidate].score) candidate = index;
      }
      if (candidate < 0) break;
      const [first, second] = splitBox(boxes[candidate]);
      boxes.splice(candidate, 1, first, second);
    }

    const refined = refineCentroids(entries, boxes.map((box) => centroid(box.entries)));
    const unique = [...new Map(refined.map((rgb) => [P.rgbToHex(rgb), rgb])).values()];
    return unique.sort((a, b) => P.rgbToOklab(...a)[0] - P.rgbToOklab(...b)[0]);
  }

  P.ADAPTIVE_SIZES = ADAPTIVE_SIZES;
  P.getAdaptivePaletteSize = getAdaptivePaletteSize;
  P.extractAdaptivePalette = extractAdaptivePalette;
})(window.Pixelator = window.Pixelator || {});
