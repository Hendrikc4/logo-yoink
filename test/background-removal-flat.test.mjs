import test from 'node:test';
import assert from 'node:assert/strict';
import { assessInteriorDetails, reconstructFlatBackground } from '../src/background-removal-flat.mjs';

function icon(color = [20, 140, 50]) {
  const width = 60, height = 60, data = Buffer.alloc(width * height * 4, 255), alpha = Buffer.alloc(width * height);
  for (let y = 10; y < 50; y++) for (let x = 10; x < 50; x++) {
    data.set([...color, 255], (y * width + x) * 4); alpha[y * width + x] = 255;
  }
  for (let y = 25; y < 35; y++) for (let x = 20; x < 40; x++) data.set([255, 255, 255, 255], (y * width + x) * 4);
  return { data, alpha, width, height };
}
test('colored filled icons retain intentional white interiors', () => {
  const { data, alpha, width, height } = icon();
  assert.equal(assessInteriorDetails(data, alpha, width, height), null);
  for (let y = 25; y < 35; y++) alpha.fill(0, y * width + 20, y * width + 40);
  assert.equal(assessInteriorDetails(data, alpha, width, height), 'interior-detail-uncertain');
});
test('uncertain opaque counters inside monochrome graphics are refused', () => {
  const { data, alpha, width, height } = icon([0, 0, 0]);
  assert.equal(assessInteriorDetails(data, alpha, width, height), 'interior-detail-uncertain');
  for (let y = 25; y < 35; y++) alpha.fill(0, y * width + 20, y * width + 40);
  assert.equal(assessInteriorDetails(data, alpha, width, height), null);
});
test('flat reconstruction requires foreground and exterior background model evidence', () => {
  const { data, alpha, width, height } = icon();
  assert.ok(reconstructFlatBackground(data, alpha, width, height));
  assert.equal(reconstructFlatBackground(data, Buffer.alloc(width * height), width, height), null);
  assert.equal(reconstructFlatBackground(data, Buffer.alloc(width * height, 255), width, height), null);
});
