(function (P) {
  "use strict";

  const DEFAULT_CONFIG = Object.freeze({
    targetWidth: 96,
    resolutionPreset: "96",
    outputScale: 4,
    sampling: "smooth",
    palette: "original",
    customPalette: "#17111A #F7F1E3 #FF5252 #33D9B2 #34ACE0",
    dither: "auto",
    outlineColorMode: "theme",
    outlineColor: "#151515",
    outlineThickness: 1,
    fps: 24
  });

  class AppState extends EventTarget {
    constructor() {
      super();
      this.config = { ...DEFAULT_CONFIG };
      this.media = null;
    }

    updateConfig(patch) {
      this.config = { ...this.config, ...patch };
      this.dispatchEvent(new CustomEvent("configchange", { detail: this.config }));
    }

    resetConfig() {
      this.config = { ...DEFAULT_CONFIG };
      this.dispatchEvent(new CustomEvent("configreset", { detail: this.config }));
      this.dispatchEvent(new CustomEvent("configchange", { detail: this.config }));
    }
  }

  P.DEFAULT_CONFIG = DEFAULT_CONFIG;
  P.AppState = AppState;
})(window.Pixelator = window.Pixelator || {});
