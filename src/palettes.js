(function (P) {
  "use strict";

  const PALETTES = Object.freeze({
    mono: ["#111116", "#f4f0e8"],
    gameboy: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
    gray8: ["#0b0b0d", "#29292d", "#49494f", "#6c6b72", "#929096", "#b7b4b8", "#dad6d7", "#fffaf5"],
    pico8: ["#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8", "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa"],
    cga16: ["#000000", "#0000aa", "#00aa00", "#00aaaa", "#aa0000", "#aa00aa", "#aa5500", "#aaaaaa", "#555555", "#5555ff", "#55ff55", "#55ffff", "#ff5555", "#ff55ff", "#ffff55", "#ffffff"]
  });

  function normalizeHex(value) {
    const raw = String(value || "").trim();
    if (/^#[0-9a-f]{3}$/i.test(raw)) {
      return "#" + raw.slice(1).split("").map((char) => char + char).join("").toLowerCase();
    }
    return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : null;
  }

  function parseCustomPalette(text) {
    const tokens = String(text || "").split(/[\s,;]+/).filter(Boolean);
    const colors = [];
    for (const token of tokens) {
      const color = normalizeHex(token);
      if (color && !colors.includes(color)) colors.push(color);
      if (colors.length === 32) break;
    }
    return colors;
  }

  function hexToRgb(hex) {
    const normalized = normalizeHex(hex);
    if (!normalized) return null;
    const value = Number.parseInt(normalized.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function getPalette(id, customText) {
    if (id === "original") return null;
    if (/^adaptive(?:8|16|32)$/.test(id)) return null;
    const colors = id === "custom" ? parseCustomPalette(customText) : (PALETTES[id] || PALETTES.mono);
    return colors.map(hexToRgb).filter(Boolean);
  }

  function getPaletteHex(id, customText) {
    if (id === "original") return [];
    if (/^adaptive(?:8|16|32)$/.test(id)) return [];
    return id === "custom" ? parseCustomPalette(customText) : (PALETTES[id] || PALETTES.mono).slice();
  }

  P.PALETTES = PALETTES;
  P.hexToRgb = hexToRgb;
  P.parseCustomPalette = parseCustomPalette;
  P.getPalette = getPalette;
  P.getPaletteHex = getPaletteHex;
})(window.Pixelator = window.Pixelator || {});
