import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const fixture = JSON.parse(await readFile(new URL('../fixtures/companies-500.json', import.meta.url), 'utf8'));

test('expanded company fixture preserves cohort counts and canonical domains', () => {
  assert.equal(fixture.companies.length, 800);
  assert.deepEqual(
    Object.fromEntries(['original-100', 'additional-400', 'major-brands-300'].map(cohort => [cohort, fixture.companies.filter(row => row.cohort === cohort).length])),
    { 'original-100': 100, 'additional-400': 400, 'major-brands-300': 300 },
  );
  assert.ok(fixture.companies.some(row => row.name === 'Apple' && row.website === 'apple.com'));
  assert.ok(fixture.companies.some(row => row.name === 'Google' && row.website === 'google.com'));
  assert.ok(fixture.companies.some(row => row.name === 'Pepsi' && row.website === 'pepsi.com'));
  assert.equal(new Set(fixture.companies.map(row => row.entity_id)).size, fixture.companies.length);
  assert.equal(new Set(fixture.companies.map(row => row.website.toLowerCase())).size, fixture.companies.length);
  assert.ok(fixture.companies.every(row => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(row.website)));
});
