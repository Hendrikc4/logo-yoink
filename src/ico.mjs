/** Select and decode the highest-quality ICO frame for image analysis. */
export function decodeIcoFrame(bytes) {
  if (bytes.length < 22 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return null;
  const count = bytes.readUInt16LE(4);
  if (!count || bytes.length < 6 + count * 16) throw new Error('Invalid ICO directory.');
  const entries = Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16;
    const width = bytes[offset] || 256;
    const height = bytes[offset + 1] || 256;
    return { width, height, bits: bytes.readUInt16LE(offset + 6), size: bytes.readUInt32LE(offset + 8), offset: bytes.readUInt32LE(offset + 12) };
  }).sort((a, b) => (b.width * b.height * b.bits) - (a.width * a.height * a.bits));
  const entry = entries[0];
  const frame = bytes.subarray(entry.offset, entry.offset + entry.size);
  if (frame.length !== entry.size) throw new Error('Truncated ICO frame.');
  if (frame.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { input: frame, options: {} };

  const headerSize = frame.readUInt32LE(0);
  const width = frame.readInt32LE(4);
  const storedHeight = frame.readInt32LE(8);
  const height = Math.abs(storedHeight) / 2;
  const bits = frame.readUInt16LE(14);
  const compression = frame.readUInt32LE(16);
  if (headerSize < 40 || width < 1 || !Number.isInteger(height) || height < 1 || ![4, 32].includes(bits) || compression !== 0) {
    throw new Error('ICO frame is not an embedded PNG or supported uncompressed DIB.');
  }
  const paletteEntries = bits === 4 ? frame.readUInt32LE(32) || 16 : 0;
  const xorStart = headerSize + paletteEntries * 4;
  const xorStride = Math.ceil(width * bits / 32) * 4;
  const xorBytes = xorStride * height;
  if (frame.length < xorStart + xorBytes) throw new Error('Truncated ICO pixel data.');
  const rgba = Buffer.alloc(width * height * 4);
  let hasAlpha = false;
  for (let y = 0; y < height; y++) {
    const sourceY = storedHeight > 0 ? height - y - 1 : y;
    for (let x = 0; x < width; x++) {
      const source = xorStart + sourceY * xorStride + (bits === 32 ? x * 4 : Math.floor(x / 2));
      const target = (y * width + x) * 4;
      if (bits === 4) {
        const paletteIndex = x % 2 ? frame[source] & 0x0f : frame[source] >> 4;
        const palette = headerSize + paletteIndex * 4;
        rgba[target] = frame[palette + 2];
        rgba[target + 1] = frame[palette + 1];
        rgba[target + 2] = frame[palette];
        rgba[target + 3] = 255;
      } else {
        rgba[target] = frame[source + 2];
        rgba[target + 1] = frame[source + 1];
        rgba[target + 2] = frame[source];
        rgba[target + 3] = frame[source + 3];
        hasAlpha ||= rgba[target + 3] !== 0;
      }
    }
  }
  if (bits === 4 || !hasAlpha) {
    const maskStart = xorStart + xorBytes;
    const maskStride = Math.ceil(width / 32) * 4;
    for (let y = 0; y < height; y++) {
      const sourceY = storedHeight > 0 ? height - y - 1 : y;
      for (let x = 0; x < width; x++) {
        const mask = frame[maskStart + sourceY * maskStride + Math.floor(x / 8)] ?? 0;
        rgba[(y * width + x) * 4 + 3] = mask & (0x80 >> (x % 8)) ? 0 : 255;
      }
    }
  }
  return { input: rgba, options: { raw: { width, height, channels: 4 } } };
}
