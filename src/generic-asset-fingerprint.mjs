const SAMPLE_EDGE = 32;
const HASH_EDGE = 8;

// Visual signatures are deliberately small and bounded. The hash describes shape after
// compositing transparency onto white; the colour buckets keep unrelated monochrome marks
// from matching a catalog entry on shape alone.
const GENERIC_FINGERPRINTS = [
  { family: 'wix', reason: 'Wix default favicon', owners: ['wix'], hash: '0000007e7e000000', color: [232, 232, 232], raster: 'Dw8PDw8PDw8PDw8PDw8PDw8ODg4ODg4PDwkECQkICQ8PBwkHCQgJDw8ODw4ODg4PDw8PDw8PDw8PDw8PDw8PDw==' },
  { family: 'wordpress', reason: 'WordPress default favicon', owners: ['wordpress'], hash: '187c34b5d75a5a18', color: [176, 168, 168], raster: 'Dw4MCQkMDg8OCQQEBAUMDgwNBgoKBg8MCQwHBg0ECwkJCAsGDQYICQwFDgcJCwYMDgoMBwUNCg4PDgwJCQwODw==' },
].map(entry => ({ ...entry, pixels: Buffer.from(entry.raster, 'base64'), bits: BigInt(`0x${entry.hash}`) }));

function bitCount64(value) {
  let count = 0;
  for (let bits = BigInt(`0x${value}`); bits; bits &= bits - 1n) count += 1;
  return count;
}

export function fingerprintNormalizedPixels(data, channels, edge = SAMPLE_EDGE) {
  if (!data || channels < 4 || edge !== SAMPLE_EDGE || data.length < edge * edge * channels) return null;
  const luminance = [];
  let red = 0, green = 0, blue = 0;
  for (let blockY = 0; blockY < HASH_EDGE; blockY += 1) {
    for (let blockX = 0; blockX < HASH_EDGE; blockX += 1) {
      let blockLight = 0;
      for (let y = blockY * 4; y < blockY * 4 + 4; y += 1) for (let x = blockX * 4; x < blockX * 4 + 4; x += 1) {
        const offset = (y * edge + x) * channels;
        const alpha = data[offset + 3] / 255;
        const r = data[offset] * alpha + 255 * (1 - alpha);
        const g = data[offset + 1] * alpha + 255 * (1 - alpha);
        const b = data[offset + 2] * alpha + 255 * (1 - alpha);
        red += r; green += g; blue += b;
        blockLight += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      luminance.push(blockLight / 16);
    }
  }
  const mean = luminance.reduce((sum, value) => sum + value, 0) / luminance.length;
  let bits = 0n;
  for (const value of luminance) bits = (bits << 1n) | BigInt(value < mean ? 1 : 0);
  const pixels = edge * edge;
  const raster = Buffer.from(luminance.map(value => Math.round(value / 17)));
  return {
    version: 1,
    hash: bits.toString(16).padStart(16, '0'),
    raster: raster.toString('base64'),
    color: [red, green, blue].map(total => Math.min(255, Math.round(total / pixels / 8) * 8)),
  };
}

export function matchGenericFingerprint(fingerprint) {
  if (typeof fingerprint?.hash !== 'string' || typeof fingerprint.raster !== 'string' ||
    fingerprint.raster.length !== 88 || !Array.isArray(fingerprint.color)) return null;
  if (!/^[0-9a-f]{16}$/i.test(fingerprint.hash) || fingerprint.color.length !== 3 || !fingerprint.color.every(Number.isFinite)) return null;
  const candidateRaster = Buffer.from(fingerprint.raster, 'base64');
  if (candidateRaster.length !== 64) return null;
  const bits = BigInt(`0x${fingerprint.hash}`);
  for (const entry of GENERIC_FINGERPRINTS) {
    const referenceRaster = entry.pixels;
    const distance = bitCount64((bits ^ entry.bits).toString(16));
    const colorDistance = Math.max(...entry.color.map((value, index) => Math.abs(value - fingerprint.color[index])));
    let rasterDistance = 0;
    for (let index = 0; index < 64; index += 1) rasterDistance += Math.abs(candidateRaster[index] - referenceRaster[index]);
    rasterDistance /= 64;
    if (distance <= 4 && colorDistance <= 16 && rasterDistance <= 0.35) return { family: entry.family, reason: entry.reason, owners: entry.owners, method: 'normalized-pixel-fingerprint', distance, rasterDistance: Math.round(rasterDistance * 1000) / 1000 };
  }
  return null;
}
