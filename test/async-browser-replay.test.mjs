import test from 'node:test';
import assert from 'node:assert/strict';
import { conflictsWithRequestedIdentity, explicitBrowserIdentity } from '../scripts/replay-browser-observations.mjs';
import { missingWideQueue, observationCacheState, observationKey } from '../scripts/warm-browser-observations.mjs';

function candidate(alt, overrides = {}) {
  return { evidence: { alt, aria_label: '', home_linked: true, positive_token: true, ...overrides } };
}

test('browser identity veto requires an explicit home-linked brand declaration', () => {
  assert.equal(explicitBrowserIdentity(candidate('RealReports Logo')), 'RealReports');
  assert.equal(explicitBrowserIdentity(candidate('site-logo')), null);
  assert.equal(explicitBrowserIdentity(candidate('Partner Logo', { home_linked: false })), null);
});

test('browser identity veto rejects foreign brands but accepts spacing variants', () => {
  assert.equal(conflictsWithRequestedIdentity(candidate('RealReports Logo'), { name: 'Bhr', domain: 'bhr.fyi' }), true);
  assert.equal(conflictsWithRequestedIdentity(candidate('AHG Pay Logo'), { name: 'Ahgpay', domain: 'ahgpay.com' }), false);
  assert.equal(conflictsWithRequestedIdentity(candidate('Utiq Logo'), { name: 'Utiq', domain: 'utiq.com' }), false);
});

test('browser observations are content-addressed and queue only reachable wide misses', () => {
  const input = { url: 'https://example.com/', company: 'Example', browserVersion: '1' };
  assert.equal(observationKey(input), observationKey({ ...input }));
  assert.notEqual(observationKey(input), observationKey({ ...input, company: 'Another' }));
  const base = { status: 'success', reachability: 'live_html', selected_by_role: { wide: null } };
  assert.equal(missingWideQueue([base, { ...base, selected_by_role: { wide: 'selected' } }, { ...base, reachability: 'blocked_interstitial' }]).length, 1);
});

test('browser observation TTL preserves fresh entries and expires stale entries', async () => {
  const path = new URL(import.meta.url).pathname;
  assert.equal(await observationCacheState(`${path}.missing`, 1, Date.now()), 'miss');
  const modified = (await import('node:fs/promises')).stat(path).then(value => value.mtimeMs);
  assert.equal(await observationCacheState(path, Infinity, 0), 'fresh');
  assert.equal(await observationCacheState(path, 1_000, await modified), 'fresh');
  assert.equal(await observationCacheState(path, 0, await modified), 'stale');
  assert.equal(await observationCacheState(path, 1_000, (await modified) + 1_000), 'stale');
});
