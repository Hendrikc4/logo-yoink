import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { summarizeOrderingEvidence } from '../scripts/experiments/bimi-ordering-audit.mjs';

test('recomputes the tracked BIMI ordering audit from sanitized frozen inputs', async () => {
  const input = JSON.parse(await readFile(new URL('../reports/bimi-fallback-2026-08-25/ordering-inputs.json', import.meta.url), 'utf8'));
  const expected = JSON.parse(await readFile(new URL('../reports/bimi-fallback-2026-08-25/ordering-audit.json', import.meta.url), 'utf8'));
  assert.deepEqual(summarizeOrderingEvidence(input), expected);
});
