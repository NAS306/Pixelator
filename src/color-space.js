(function (P) {
  "use strict";

  function srgbToLinear(value) {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }

  function rgbToOklab(r, g, b) {
    const red = srgbToLinear(r);
    const green = srgbToLinear(g);
    const blue = srgbToLinear(b);
    const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
    const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
    const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    ];
  }

  function rgbToHex(rgb) {
    return "#" + rgb.map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")).join("");
  }

  P.rgbToOklab = rgbToOklab;
  P.rgbToHex = rgbToHex;
})(window.Pixelator = window.Pixelator || {});
