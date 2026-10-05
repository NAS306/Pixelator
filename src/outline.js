(function (P) {
  "use strict";

  function hasTransparency(imageData) {
    const data = imageData.data;
    for (let index = 3; index < data.length; index += 4) {
      if (data[index] < 255) return true;
    }
    return false;
  }

  function buildOutlinedPixels(imageData, width, height, color, requestedThickness) {
    const thickness = Math.max(0, Math.min(8, Math.round(Number(requestedThickness) || 0)));
    if (!thickness) {
      return { data: new Uint8ClampedArray(imageData.data), width, height };
    }

    const outputWidth = width + thickness * 2;
    const outputHeight = height + thickness * 2;
    const sourceMask = new Uint8Array(outputWidth * outputHeight);
    let expandedMask = new Uint8Array(outputWidth * outputHeight);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceIndex = (y * width + x) * 4;
        const targetPixel = (y + thickness) * outputWidth + x + thickness;
        if (imageData.data[sourceIndex + 3] > 0) {
          sourceMask[targetPixel] = 1;
          expandedMask[targetPixel] = 1;
        }
      }
    }

    for (let pass = 0; pass < thickness; pass += 1) {
      const nextMask = expandedMask.slice();
      for (let y = 0; y < outputHeight; y += 1) {
        for (let x = 0; x < outputWidth; x += 1) {
          const pixel = y * outputWidth + x;
          if (!expandedMask[pixel]) continue;
          for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
            const nextY = y + offsetY;
            if (nextY < 0 || nextY >= outputHeight) continue;
            for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
              const nextX = x + offsetX;
              if (nextX >= 0 && nextX < outputWidth) nextMask[nextY * outputWidth + nextX] = 1;
            }
          }
        }
      }
      expandedMask = nextMask;
    }

    const output = new Uint8ClampedArray(outputWidth * outputHeight * 4);
    for (let pixel = 0; pixel < expandedMask.length; pixel += 1) {
      if (!expandedMask[pixel] || sourceMask[pixel]) continue;
      const targetIndex = pixel * 4;
      output[targetIndex] = color[0];
      output[targetIndex + 1] = color[1];
      output[targetIndex + 2] = color[2];
      output[targetIndex + 3] = 255;
    }

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceIndex = (y * width + x) * 4;
        const targetIndex = ((y + thickness) * outputWidth + x + thickness) * 4;
        const alpha = imageData.data[sourceIndex + 3] / 255;
        if (!alpha) continue;
        const inverseAlpha = 1 - alpha;
        output[targetIndex] = Math.round(imageData.data[sourceIndex] * alpha + color[0] * inverseAlpha);
        output[targetIndex + 1] = Math.round(imageData.data[sourceIndex + 1] * alpha + color[1] * inverseAlpha);
        output[targetIndex + 2] = Math.round(imageData.data[sourceIndex + 2] * alpha + color[2] * inverseAlpha);
        output[targetIndex + 3] = 255;
      }
    }

    return { data: output, width: outputWidth, height: outputHeight };
  }

  function drawPixelOutline(context, source, width, height, color, requestedThickness) {
    const thickness = Math.max(0, Math.min(8, Math.round(Number(requestedThickness) || 0)));
    context.save();
    context.imageSmoothingEnabled = false;
    context.globalCompositeOperation = "source-over";

    for (let offsetY = -thickness; offsetY <= thickness; offsetY += 1) {
      for (let offsetX = -thickness; offsetX <= thickness; offsetX += 1) {
        context.drawImage(source, thickness + offsetX, thickness + offsetY, width, height);
      }
    }

    context.globalCompositeOperation = "source-in";
    context.fillStyle = "rgb(" + color[0] + ", " + color[1] + ", " + color[2] + ")";
    context.fillRect(0, 0, width + thickness * 2, height + thickness * 2);
    context.globalCompositeOperation = "source-over";
    context.drawImage(source, thickness, thickness, width, height);
    context.restore();
  }

  P.hasTransparency = hasTransparency;
  P.buildOutlinedPixels = buildOutlinedPixels;
  P.drawPixelOutline = drawPixelOutline;
})(window.Pixelator = window.Pixelator || {});
