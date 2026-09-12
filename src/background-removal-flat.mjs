// Model-guided reconstruction for graphic logos on demonstrably uniform canvas.
// Background connectivity matters: identical-colored enclosed brand details are
// kept unless the model identifies that enclosed region as a cutout.
export function reconstructFlatBackground(data, mask, width, height) {
  const n = width * height;
  if (mask.length !== n || data.length !== n * 4) return null;
  const border = [];
  for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y++) border.push(y * width, y * width + width - 1);
  const bg = [0, 1, 2].map(c => border.map(p => data[p * 4 + c]).sort((a, b) => a - b)[Math.floor(border.length / 2)]);
  const distance = p => Math.hypot(data[p * 4] - bg[0], data[p * 4 + 1] - bg[1], data[p * 4 + 2] - bg[2]);
  if (border.filter(p => distance(p) <= 12).length / border.length < 0.95) return null;
  let foreground = 0, supported = 0, smooth = 0;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const p = y * width + x;
    if (distance(p) <= 64) continue;
    foreground++; supported += mask[p] / 255;
    if ([p - 1, p + 1, p - width, p + width].every(q => Math.hypot(data[p * 4] - data[q * 4], data[p * 4 + 1] - data[q * 4 + 1], data[p * 4 + 2] - data[q * 4 + 2]) <= 25)) smooth++;
  }
  if (foreground < n * 0.005 || foreground > n * 0.85 || supported / foreground < 0.2 || smooth / foreground < 0.2) return null;
  const visited = new Uint8Array(n), background = new Uint8Array(n), queue = new Int32Array(n);
  const flood = (start, exterior) => {
    let head = 0, tail = 1, alpha = 0;
    queue[0] = start; visited[start] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      alpha += mask[p];
      for (const q of [x ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y ? p - width : -1, y + 1 < height ? p + width : -1]) {
        if (q >= 0 && !visited[q] && distance(q) <= 18) { visited[q] = 1; queue[tail++] = q; }
      }
    }
    if (exterior || alpha / tail < 128) for (let i = 0; i < tail; i++) background[queue[i]] = 1;
  };
  for (const p of border) if (!visited[p] && distance(p) <= 18) flood(p, true);
  for (let p = 0; p < n; p++) if (!visited[p] && distance(p) <= 18) flood(p, false);
  const out = Buffer.from(data);
  let cleared = 0, supportedBackground = 0, weakForeground = 0;
  for (let p = 0; p < n; p++) {
    out[p * 4 + 3] = background[p] ? 0 : 255; cleared += background[p];
    if (background[p] && mask[p] < 128) supportedBackground++;
    if (!background[p] && distance(p) < 64) weakForeground++;
  }
  if (cleared < n * 0.05 || cleared > n * 0.995 || supportedBackground < cleared * 0.05 || weakForeground > foreground * 0.25) return null;
  // A soft gray shadow has no nearby solid foreground color to reconstruct.
  // Making that region opaque would create a bright halo on a dark composite.
  let unsupportedGray = 0;
  for (let p = 0; p < n; p++) {
    if (background[p] || mask[p] >= 230 || distance(p) >= 160 || distance(p) <= 18) continue;
    const color = [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]];
    if (Math.max(...color) - Math.min(...color) > 12) continue;
    const x = p % width, y = Math.floor(p / width);
    let nearby = false;
    for (let dy = -2; dy <= 2 && !nearby; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && distance(ny * width + nx) >= 160) { nearby = true; break; }
    }
    if (!nearby) unsupportedGray++;
  }
  if (unsupportedGray > Math.max(8, foreground * 0.005)) return null;
  return out;
}

// Uniform-color interior regions need separate checks: RGB foreground contrast
// alone cannot notice a white symbol punched out of a filled colored icon.
export function assessInteriorDetails(data, alpha, width, height) {
  const n = width * height, border = [];
  for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y++) border.push(y * width, y * width + width - 1);
  const bg = [0, 1, 2].map(c => border.map(p => data[p * 4 + c]).sort((a, b) => a - b)[Math.floor(border.length / 2)]);
  const near = p => Math.hypot(data[p * 4] - bg[0], data[p * 4 + 1] - bg[1], data[p * 4 + 2] - bg[2]) <= 18;
  if (border.filter(near).length / border.length < 0.95) return null;
  const labels = new Int32Array(n), queue = new Int32Array(n), groups = [null];
  const neighbors = p => { const x = p % width, y = Math.floor(p / width); return [x ? p - 1 : -1, x + 1 < width ? p + 1 : -1, y ? p - width : -1, y + 1 < height ? p + width : -1]; };
  for (let start = 0; start < n; start++) {
    if (labels[start] || near(start)) continue;
    const id = groups.length;
    let head = 0, tail = 1, minX = width, minY = height, maxX = 0, maxY = 0, chroma = 0;
    queue[0] = start; labels[start] = id;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      chroma += Math.max(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]) - Math.min(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
      for (const q of neighbors(p)) if (q >= 0 && !labels[q] && !near(q)) { labels[q] = id; queue[tail++] = q; }
    }
    groups.push({ area: tail, density: tail / ((maxX - minX + 1) * (maxY - minY + 1)), chroma: chroma / tail });
  }
  const visited = new Uint8Array(n);
  for (let start = 0; start < n; start++) {
    if (labels[start] || visited[start]) continue;
    let head = 0, tail = 1, exterior = false, sum = 0;
    const adjacent = new Map(); queue[0] = start; visited[start] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      exterior ||= !x || !y || x === width - 1 || y === height - 1; sum += alpha[p];
      for (const q of neighbors(p)) if (q >= 0) {
        if (labels[q]) adjacent.set(labels[q], (adjacent.get(labels[q]) ?? 0) + 1);
        else if (!visited[q]) { visited[q] = 1; queue[tail++] = q; }
      }
    }
    if (exterior || tail < 3) continue;
    const id = [...adjacent].sort((a, b) => b[1] - a[1])[0]?.[0], group = groups[id];
    if (!group) continue;
    const opacity = sum / (tail * 255);
    if (group.chroma > 30 && group.density > 0.6 && opacity < 0.9) return 'interior-detail-uncertain';
    if (opacity > 0.5 && (group.chroma <= 30 || group.density < 0.6)) return 'interior-detail-uncertain';
    if (opacity > 0.5 && tail > group.area * 0.5) return 'interior-detail-uncertain';
    const coloredCanvas = Math.max(...bg) - Math.min(...bg) > 8;
    if (coloredCanvas && opacity > 0.5 && tail > 8) return 'interior-detail-uncertain';
  }
  return null;
}
