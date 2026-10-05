(function (P) {
  "use strict";

  function boot() {
    const state = new P.AppState();
    const media = new P.MediaController();
    const renderer = new P.PixelRenderer(
      document.getElementById("outputCanvas"),
      document.getElementById("originalCanvas"),
      media,
      state
    );
    new P.PixelatorUI(state, media, renderer);
    renderer.start();

    window.addEventListener("beforeunload", () => media.dispose());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})(window.Pixelator = window.Pixelator || {});
