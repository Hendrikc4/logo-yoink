import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { summarizeOrderingEvidence } from '../scripts/experiments/bimi-ordering-audit.mjs';

test('recomputes the tracked BIMI ordering audit from sanitized frozen inputs', async () => {
  const input = JSON.parse(await readFile(new URL('../reports/bimi-fallback-2026-08-25/ordering-inputs.json', import.meta.url), 'utf8'));
  const expected = JSON.parse(await readFile(new URL('../reports/bimi-fallback-2026-08-25/ordering-audit.json', import.meta.url), 'utf8'));
  assert.deepEqual(summarizeOrderingEvidence(input), expected);
  const summary = JSON.parse(await readFile(new URL('../reports/bimi-fallback-2026-08-25/summary.json', import.meta.url), 'utf8'));
  assert.deepEqual(summary.ordering_audit, expected);
});

test('ordering audit rejects empty, nonnumeric, and unbounded evidence', () => {
  assert.throws(() => summarizeOrderingEvidence({ schema_version: 1, changed_selections: [] }), /at least one/);
  const cacheConfiguration = { besticon_enabled: false, google_favicon_enabled: true, duckduckgo_favicon_enabled: true };
  assert.throws(() => summarizeOrderingEvidence({ schema_version: 1, changed_selections: [{}], third_party_cache_configuration: cacheConfiguration, gated_cost: {} }), /gated cost/);
  assert.throws(() => summarizeOrderingEvidence({ schema_version: 1, changed_selections: [{}], third_party_cache_configuration: {}, gated_cost: {} }), /cache configuration/);
});
