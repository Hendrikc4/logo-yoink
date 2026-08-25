import assert from 'node:assert/strict';
import test from 'node:test';
import { mapConcurrent } from '../src/concurrency.mjs';

test('mapConcurrent limits active work and preserves input order', async () => {
  let active = 0;
  let maximum = 0;
  const completed = [];
  const output = await mapConcurrent([30, 5, 20, 1], 2, async (delay, index) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, delay));
    active -= 1;
    return `result-${index}`;
  }, async (value, index) => {
    completed.push([value, index]);
  });

  assert.equal(maximum, 2);
  assert.deepEqual(output, ['result-0', 'result-1', 'result-2', 'result-3']);
  assert.deepEqual(new Set(completed.map(([, index]) => index)), new Set([0, 1, 2, 3]));
});

test('mapConcurrent handles empty input without invoking callbacks', async () => {
  let called = false;
  assert.deepEqual(await mapConcurrent([], 2, () => { called = true; }), []);
  assert.equal(called, false);
});

test('mapConcurrent rejects invalid concurrency instead of silently skipping work', async () => {
  await assert.rejects(() => mapConcurrent([1], 0, value => value), /positive integer/);
  await assert.rejects(() => mapConcurrent([1], 1.5, value => value), /positive integer/);
});
