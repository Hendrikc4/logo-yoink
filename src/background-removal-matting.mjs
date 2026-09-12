// Model-guided local foreground projection: only refine edges next to confirmed background.
export function matteEdges(data, width, height) {
  const out = Buffer.from(data),
    n = width * height,
    border = [];
  for (let x = 0; x < width; x++) {
    border.push(x, (height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++)
    border.push(y * width, y * width + width - 1);
  const bg = [0, 1, 2].map(
    (c) =>
      border.map((p) => data[p * 4 + c]).sort((a, b) => a - b)[
        Math.floor(border.length / 2)
      ],
  );
  const dist = (p) => Math.hypot(...bg.map((v, c) => data[p * 4 + c] - v));
  if (border.filter((p) => dist(p) <= 30).length / border.length < 0.95)
    return {
      data: out,
      reason: "uncertain-background",
      correctedPixels: 0,
      unresolvedPixels: 0,
    };
  const flood = new Uint8Array(n),
    queue = new Int32Array(n);
  let head = 0,
    tail = 0;
  for (const p of border)
    if (!flood[p] && dist(p) <= 30) {
      flood[p] = 1;
      queue[tail++] = p;
    }
  for (let p = 0; p < n; p++)
    if (!flood[p] && data[p * 4 + 3] < 16 && dist(p) <= 30) {
      flood[p] = 1;
      queue[tail++] = p;
    }
  while (head < tail) {
    const p = queue[head++],
      x = p % width,
      y = Math.floor(p / width);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      let nx = x + dx,
        ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      let k = ny * width + nx;
      if (!flood[k] && dist(k) <= 30) {
        flood[k] = 1;
        queue[tail++] = k;
      }
    }
  }
  let edgeCandidates = 0,
    unresolved = 0,
    unresolvedWeight = 0,
    unresolvedBackgroundWeight = 0,
    correctedPixels = 0;
  const core = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    const x = p % width,
      y = Math.floor(p / width);
    if (
      data[p * 4 + 3] < 245 ||
      dist(p) < 64 ||
      !x ||
      !y ||
      x === width - 1 ||
      y === height - 1
    )
      continue;
    let uniform = true;
    for (const k of [p - 1, p + 1, p - width, p + width])
      if (
        Math.hypot(...[0, 1, 2].map((c) => data[k * 4 + c] - data[p * 4 + c])) >
        25
      )
        uniform = false;
    if (uniform) core[p] = 1;
  }
  for (let p = 0; p < n; p++) {
    if (data[p * 4 + 3] === 0) continue;
    const x = p % width,
      y = Math.floor(p / width);
    let edge = false;
    for (let dy = -2; dy <= 2 && !edge; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        let nx = x + dx,
          ny = y + dy;
        if (
          nx >= 0 &&
          nx < width &&
          ny >= 0 &&
          ny < height &&
          flood[ny * width + nx]
        ) {
          edge = true;
          break;
        }
      }
    if (!edge) continue;
    if (data[p * 4 + 3] >= 16) edgeCandidates++;
    let best = null;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const q = ny * width + nx;
        if (!core[q]) continue;
        const f = bg.map((b, c) => data[q * 4 + c] - b),
          c = bg.map((b, c) => data[p * 4 + c] - b),
          den = f.reduce((a, v) => a + v * v, 0);
        const a = c.reduce((s, v, k) => s + v * f[k], 0) / den;
        if (a < 0 || a > 1.01) continue;
        const residual = Math.hypot(...c.map((v, k) => v - a * f[k]));
        if (residual > 12) continue;
        const score = dx * dx + dy * dy + residual * residual;
        if (!best || score < best.score) best = { q, a: Math.min(1, a), score };
      }
    if (!best) {
      if (data[p * 4 + 3] >= 16) {
        unresolved++;
        // Opaque strokes need no color unmixing. Intermediate alpha has the
        // greatest halo risk; tolerate a small amount of it without recoloring
        // uncertain pixels or rejecting every JPEG edge.
        const alpha = data[p * 4 + 3] / 255;
        // A retained pixel inside confirmed background is residue even when
        // opaque; do not mistake an opaque white patch for a crisp stroke.
        unresolvedWeight += flood[p] ? alpha : 4 * alpha * (1 - alpha);
        if (flood[p]) unresolvedBackgroundWeight += alpha;
      }
      continue;
    }
    out[p * 4 + 3] = Math.round(best.a * 255);
    for (let c = 0; c < 3; c++) out[p * 4 + c] = data[best.q * 4 + c];
    if ([0, 1, 2, 3].some((c) => out[p * 4 + c] !== data[p * 4 + c]))
      correctedPixels++;
  }
  return {
    data: out,
    reason:
      unresolvedWeight > Math.max(8, edgeCandidates * 0.2) ||
      unresolvedBackgroundWeight > Math.max(2, edgeCandidates * 0.05)
        ? "edge-uncertain" : null,
    edgeCandidates,
    correctedPixels,
    unresolvedPixels: unresolved,
    unresolvedWeight,
    unresolvedBackgroundWeight,
  };
}
