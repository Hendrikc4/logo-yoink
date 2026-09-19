import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { decodeIcoFrame } from '../src/ico.mjs';
import { measureTinyImageSuitability } from '../src/tiny-image-suitability.mjs';

function dibIco(bits) {
  const width = 2;
  const height = 1;
  const palette = bits === 8 ? Buffer.from([0, 0, 255, 0, 0, 255, 0, 0]) : Buffer.alloc(0);
  const xor = bits === 8
    ? Buffer.from([0, 1, 0, 0])
    : Buffer.from([0, 0, 255, 0, 255, 0, 0, 0]);
  const mask = Buffer.from([0x40, 0, 0, 0]);
  const frame = Buffer.alloc(40 + palette.length + xor.length + mask.length);
  frame.writeUInt32LE(40, 0);
  frame.writeInt32LE(width, 4);
  frame.writeInt32LE(height * 2, 8);
  frame.writeUInt16LE(1, 12);
  frame.writeUInt16LE(bits, 14);
  if (bits === 8) frame.writeUInt32LE(2, 32);
  palette.copy(frame, 40);
  xor.copy(frame, 40 + palette.length);
  mask.copy(frame, 40 + palette.length + xor.length);
  const bytes = Buffer.alloc(22 + frame.length);
  bytes.writeUInt16LE(1, 2);
  bytes.writeUInt16LE(1, 4);
  bytes[6] = width;
  bytes[7] = height;
  bytes.writeUInt16LE(1, 10);
  bytes.writeUInt16LE(bits, 12);
  bytes.writeUInt32LE(frame.length, 14);
  bytes.writeUInt32LE(22, 18);
  frame.copy(bytes, 22);
  return bytes;
}

test('uncompressed 8-bit palette and 24-bit ICO frames decode exact RGBA pixels', () => {
  for (const bits of [8, 24]) {
    const decoded = decodeIcoFrame(dibIco(bits));
    assert.deepEqual(decoded.options, { raw: { width: 2, height: 1, channels: 4 } });
    assert.deepEqual([...decoded.input], [255, 0, 0, 255, 0, 255, 0, 0]);
  }
});

test('every formerly unsupported approved ICO produces measurable pixels', async () => {
  const manifestPath = resolve('brand-library/v2/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const expectedEdges = new Map([
    ['alibaba', 16], ['prudential', 32], ['thermo-fisher-scientific', 16], ['keyence', 144], ['millicom', 16],
    ['xfinity', 64], ['popeyes', 32], ['tidal', 48], ['celine', 48], ['zapier', 192],
  ]);
  const ids = new Set(expectedEdges.keys());
  const checked = [];
  for (const brand of manifest.brands.filter(item => ids.has(item.id))) {
    const asset = brand.assets?.icon;
    assert.equal(asset?.format, 'ico');
    const bytes = await readFile(resolve(dirname(manifestPath), asset.path));
    const decoded = decodeIcoFrame(bytes);
    assert.equal(decoded.options.raw.width, expectedEdges.get(brand.id));
    assert.equal(decoded.options.raw.height, expectedEdges.get(brand.id));
    const suitability = await measureTinyImageSuitability(decoded.input, decoded.options);
    assert.ok(suitability, `${brand.id} should produce measurable pixels`);
    checked.push(brand.id);
  }
  assert.deepEqual(new Set(checked), ids);
});
