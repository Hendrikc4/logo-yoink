import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const legacy = JSON.parse(await readFile(new URL('../fixtures/companies-500.json', import.meta.url), 'utf8'));
const expanded = JSON.parse(await readFile(new URL('../fixtures/companies-800.json', import.meta.url), 'utf8'));

test('expanded company fixture preserves the frozen 500 and adds canonical major-brand domains', () => {
  assert.equal(legacy.companies.length, 500);
  assert.equal(expanded.companies.length, 800);
  assert.deepEqual(expanded.companies.slice(0, 500), legacy.companies);
  assert.deepEqual(
    Object.fromEntries(['original-100', 'additional-400', 'major-brands-300'].map(cohort => [cohort, expanded.companies.filter(row => row.cohort === cohort).length])),
    { 'original-100': 100, 'additional-400': 400, 'major-brands-300': 300 },
  );
  assert.ok(expanded.companies.some(row => row.name === 'Apple' && row.website === 'apple.com'));
  assert.ok(expanded.companies.some(row => row.name === 'Google' && row.website === 'google.com'));
  assert.ok(expanded.companies.some(row => row.name === 'Pepsi' && row.website === 'pepsi.com'));
  assert.equal(new Set(expanded.companies.map(row => row.entity_id)).size, expanded.companies.length);
  assert.equal(new Set(expanded.companies.map(row => row.website.toLowerCase())).size, expanded.companies.length);
  assert.ok(expanded.companies.every(row => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(row.website)));
});
