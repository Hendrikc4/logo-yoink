const SAMPLE_EDGE = 32;
const HASH_EDGE = 8;

// Visual signatures are deliberately small and bounded. The hash describes shape after
// compositing transparency onto white; the colour buckets keep unrelated monochrome marks
// from matching a catalog entry on shape alone.
const GENERIC_FINGERPRINTS = [
  { family: 'wix', reason: 'Wix default favicon', owners: ['wix'], hash: '0000007e7e000000', color: [232, 232, 232], raster: 'Dw8PDw8PDw8PDw8PDw8PDw8ODg4ODg4PDwkECQkICQ8PBwkHCQgJDw8ODw4ODg4PDw8PDw8PDw8PDw8PDw8PDw==' },
  { family: 'wordpress', reason: 'WordPress default favicon', owners: ['wordpress'], hash: '187c34b5d75a5a18', color: [176, 168, 168], raster: 'Dw4MCQkMDg8OCQQEBAUMDgwNBgoKBg8MCQwHBg0ECwkJCAsGDQYICQwFDgcJCwYMDgoMBwUNCg4PDgwJCQwODw==' },
  { family: 'godaddy', reason: 'GoDaddy default PWA logo', owners: ['godaddy'], hash: 'ffc3818199c3e7ff', color: [24, 48, 48], raster: 'AQEBAQEBAQEBAQMDAgMBAQEEBAcEBAQBAQUDBAUDBQEBBAcBAgYEAQEBBwUEBwEBAQEBAwMBAQEBAQEBAQEBAQ==' },
  { family: 'godaddy', reason: 'GoDaddy default PWA logo', owners: ['godaddy'], hash: '66dbb1ada5666618', color: [176, 240, 240], raster: 'Dw0NDg4NDQ8NDQ4LDQ4NDQwPDQ0PDw8MDA8MDw0LDwwMDg0PDg0ODA4MDQ8PDQwODw0LDg4LDQ8PDw4NDQ4PDw==' },
  { family: 'lovable', reason: 'Lovable default favicon', owners: ['lovable'], hash: '60f0f8fcfefffe7c', color: [224, 136, 160], raster: 'DQgHCQ4PDw8IBwgICg8PDwcHBwgJDw8PBwcHBwcJCg8IBwcHBwYGCQgIBwcHBwcICAgIBwcHCAoJCAgICAgKDg==' },
  { family: 'lovable', reason: 'Lovable default favicon', owners: ['lovable'], hash: '0030383c3e3e0000', color: [240, 216, 224], raster: 'Dw8PDw8PDw8PDwsKDg8PDw8OBwgKDw8PDw4JBwgKDg8PDgoJCAgLDw8OCAgJCQ0PDw8ODg4ODw8PDw8PDw8PDw==' },
  { family: 'linktree', reason: 'Linktree platform wordmark', owners: ['linktree'], hash: '0001017f6f6dfe00', color: [176, 176, 248], raster: 'Dw8PDw8PDw4MDQ0PDw8NCAwNCwsPDw4FCwUJBgUHBgILCQULBwYIBwsJBQsICAsKBgkHCAgHCQwLDQ0MDQ0NDg==' },
  { family: 'linktree', reason: 'Linktree platform icon', owners: ['linktree'], hash: '00183c3c3c181800', color: [72, 200, 88], raster: 'DgsLCwsLCw4LCwsJCQsLCwsLBwMDBwsLCwoDAAADCgsLCwcFBQcLCwsLCgcHCgsLCwsLCQkLCwsOCwsLCwsLDg==' },
  { family: 'template-chevron', reason: 'generic navigation chevron', owners: [], hash: '0081c3e77e3c1800', color: [255, 248, 255], raster: 'Dw8PDw8PDw8PDw8PDw8PDw4ODw8PDw4ODw8ODw8ODw8PDw8ODg8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw8PDw==' },
  { family: 'template-chevron', reason: 'generic navigation chevron', owners: [], hash: '0000c3663c180000', color: [248, 248, 248], raster: 'Dw8PDw8PDw8PDw8PDw8PDw0ODw8PDw4MDwwODw8ODA8PDwwODgwPDw8PDwwMDw8PDw8PDw8PDw8PDw8PDw8PDw==' },
  { family: 'hi-ventures', reason: 'foreign Hi Ventures logo', owners: ['hi'], hash: '3c42a5bdadad423c', color: [176, 176, 176], raster: 'Dw0GBwcGDQ8NBg4PDw4HDQYPBQ8PCQ8HBw8EBwgGDwcHDwUOBwUPBwYPCA4JCA8GDQYPDw8PBw0PDQcHBwYNDw==' },
  { family: 'hi-ventures', reason: 'foreign Hi Ventures logo', owners: ['hi'], hash: '186666bdad6e6618', color: [200, 200, 200], raster: 'Dw8OCgoODw8PCwgNDQgLDw4ICg4PCwgOCg0IBwkJDQoKDQgNBwgNCg4IDA4LDAgODwsIDQ0ICw8PDw4KCg4PDw==' },
  { family: 'webroker', reason: 'foreign Webroker favicon', owners: ['webroker'], hash: 'f7092384a4e3c9f7', color: [16, 56, 88], raster: 'AAAAAwMDAAAHBAQDAwQEAQoFAwMEAwIDAQkKCQQCAwMAAwIGBQIDAwADAwMEAwIDAAEEAwMDBAEAAAADAwMAAA==' },
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
