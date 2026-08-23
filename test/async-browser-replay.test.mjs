import test from 'node:test';
import assert from 'node:assert/strict';
import { conflictsWithRequestedIdentity, explicitBrowserIdentity } from '../scripts/replay-browser-observations.mjs';

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
