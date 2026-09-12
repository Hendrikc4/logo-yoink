// Color is used only to reject an unsafe model result, never to remove pixels.
export function assessMask(data, mask, width, height) {
  const border = [];
  const sample = pixel => border.push([data[pixel * 4], data[pixel * 4 + 1], data[pixel * 4 + 2]]);
  for (let x = 0; x < width; x++) { sample(x); if (height > 1) sample((height - 1) * width + x); }
  for (let y = 1; y < height - 1; y++) { sample(y * width); if (width > 1) sample(y * width + width - 1); }
  const background = [0, 1, 2].map(channel => border.map(pixel => pixel[channel]).sort((a, b) => a - b)[Math.floor(border.length / 2)]);
  const distance = (r, g, b) => Math.hypot(r - background[0], g - background[1], b - background[2]);
  if (border.filter(pixel => distance(...pixel) <= 30).length / border.length < 0.95) return 'uncertain-background';
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let head = 0, tail = 0, backgroundAlpha = 0, opaqueBackground = 0;
  const enqueueBackground = pixel => {
    if (!visited[pixel] && distance(data[pixel * 4], data[pixel * 4 + 1], data[pixel * 4 + 2]) <= 30) {
      visited[pixel] = 1; queue[tail++] = pixel;
    }
  };
  for (let x = 0; x < width; x++) { enqueueBackground(x); enqueueBackground((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { enqueueBackground(y * width); enqueueBackground(y * width + width - 1); }
  while (head < tail) {
    const pixel = queue[head++], x = pixel % width, y = Math.floor(pixel / width);
    if (x > 0) enqueueBackground(pixel - 1); if (x + 1 < width) enqueueBackground(pixel + 1);
    if (y > 0) enqueueBackground(pixel - width); if (y + 1 < height) enqueueBackground(pixel + width);
  }
  let backgroundInterior = 0;
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (!visited[pixel]) continue;
    const x = pixel % width, y = Math.floor(pixel / width);
    if (x > 0 && !visited[pixel - 1] || x + 1 < width && !visited[pixel + 1] || y > 0 && !visited[pixel - width] || y + 1 < height && !visited[pixel + width]) continue;
    backgroundInterior++; backgroundAlpha += mask[pixel]; if (mask[pixel] > 25) opaqueBackground++;
  }
  if (!backgroundInterior || backgroundAlpha / (backgroundInterior * 255) > 0.02 || opaqueBackground / backgroundInterior > 0.01) return 'background-retained';
  const candidate = new Uint8Array(mask.length);
  let total = 0, lost = 0, severeLoss = 0, foregroundPixels = 0;
  for (let pixel = 0; pixel < mask.length; pixel++) {
    if (distance(data[pixel * 4], data[pixel * 4 + 1], data[pixel * 4 + 2]) > 64) {
      candidate[pixel] = 1;
      foregroundPixels++;
      const x = pixel % width, y = Math.floor(pixel / width);
      const neighbors = [pixel - 1, pixel + 1, pixel - width, pixel + width];
      if (x > 0 && x + 1 < width && y > 0 && y + 1 < height && neighbors.every(next => distance(data[next * 4], data[next * 4 + 1], data[next * 4 + 2]) > 64)) {
        total++; lost += 1 - mask[pixel] / 255;
        if (mask[pixel] < 128) severeLoss++;
      }
    }
  }
  // A few mildly translucent edge pixels are acceptable; broad fading or
  // genuinely missing lettering remains a structural failure.
  if (total && (lost / total > 0.03 || severeLoss / total > 0.01)) return 'foreground-loss';
  // Check disconnected dots and strokes independently so a large wordmark cannot hide their loss.
  for (let start = 0; start < mask.length; start++) {
    if (!candidate[start]) continue;
    let head = 0, tail = 1, alpha = 0;
    queue[0] = start; candidate[start] = 0;
    while (head < tail) {
      const pixel = queue[head++], x = pixel % width, y = Math.floor(pixel / width);
      alpha += mask[pixel];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (candidate[next]) { candidate[next] = 0; queue[tail++] = next; }
      }
    }
    // Ignore isolated raster specks on large artwork, but protect meaningful
    // dots and every component containing three or more contrasting pixels.
    if ((tail >= 3 || tail / foregroundPixels >= 0.002) && alpha / tail < 128) return 'foreground-component-loss';
  }
  return null;
}
