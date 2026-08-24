import sharp from 'sharp';

const SAMPLE_EDGE = 32;

function clamp(value) { return Math.max(0, Math.min(1, value)); }
function triangular(value, low, idealLow, idealHigh, high) {
  if (value <= low || value >= high) return 0;
  if (value < idealLow) return (value - low) / (idealLow - low);
  if (value <= idealHigh) return 1;
  return (high - value) / (high - idealHigh);
}

export async function measureTinyImageSuitability(input) {
  try {
    const { data, info } = await sharp(input, { limitInputPixels: 64 * 1024 * 1024 })
      .ensureAlpha()
      .resize(SAMPLE_EDGE, SAMPLE_EDGE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== SAMPLE_EDGE || info.height !== SAMPLE_EDGE || info.channels < 4) return null;
    const offset = (x, y) => (y * SAMPLE_EDGE + x) * info.channels;
    const corners = [[0, 0], [31, 0], [0, 31], [31, 31]].map(([x, y]) => offset(x, y));
    const background = [0, 1, 2, 3].map(channel => corners.reduce((sum, index) => sum + data[index + channel], 0) / corners.length);
    const transparentCanvas = background[3] < 192 || [...Array(SAMPLE_EDGE * SAMPLE_EDGE).keys()].filter(index => data[index * info.channels + 3] < 32).length > 64;
    let foreground = 0, contrastTotal = 0, left = 32, top = 32, right = -1, bottom = -1, transitions = 0;
    const mask = new Uint8Array(SAMPLE_EDGE * SAMPLE_EDGE);
    for (let y = 0; y < SAMPLE_EDGE; y++) for (let x = 0; x < SAMPLE_EDGE; x++) {
      const index = offset(x, y), alpha = data[index + 3];
      const colorDistance = (Math.abs(data[index] - background[0]) + Math.abs(data[index + 1] - background[1]) + Math.abs(data[index + 2] - background[2])) / (255 * 3);
      const isForeground = transparentCanvas ? alpha >= 48 : alpha >= 48 && colorDistance >= 0.10;
      if (!isForeground) continue;
      mask[y * SAMPLE_EDGE + x] = 1; foreground++; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      contrastTotal += transparentCanvas ? alpha / 255 : colorDistance;
    }
    if (!foreground) return { score: 0, foreground_occupancy: 0, box_occupancy: 0, contrast: 0, edge_density: 0 };
    for (let y = 0; y < SAMPLE_EDGE; y++) for (let x = 0; x < SAMPLE_EDGE; x++) {
      const current = mask[y * SAMPLE_EDGE + x];
      if (x + 1 < SAMPLE_EDGE && current !== mask[y * SAMPLE_EDGE + x + 1]) transitions++;
      if (y + 1 < SAMPLE_EDGE && current !== mask[(y + 1) * SAMPLE_EDGE + x]) transitions++;
    }
    const foregroundOccupancy = foreground / (SAMPLE_EDGE * SAMPLE_EDGE);
    const boxOccupancy = (right - left + 1) * (bottom - top + 1) / (SAMPLE_EDGE * SAMPLE_EDGE);
    const contrast = contrastTotal / foreground;
    const edgeDensity = transitions / (2 * SAMPLE_EDGE * (SAMPLE_EDGE - 1));
    const occupancyQuality = triangular(foregroundOccupancy, 0.015, 0.08, 0.62, 0.96);
    const boxQuality = triangular(boxOccupancy, 0.08, 0.32, 0.92, 1.001);
    const contrastQuality = clamp((contrast - 0.08) / 0.42);
    const complexityQuality = triangular(edgeDensity, 0.005, 0.025, 0.20, 0.48);
    const score = Math.round(1000 * (0.30 * occupancyQuality + 0.25 * boxQuality + 0.30 * contrastQuality + 0.15 * complexityQuality)) / 10;
    return { score, foreground_occupancy: foregroundOccupancy, box_occupancy: boxOccupancy, contrast, edge_density: edgeDensity };
  } catch { return null; }
}
