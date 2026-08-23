import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverBrowserLogos, internals } from '../src/discover-browser.mjs';

test('returns actionable diagnostics when Playwright is unavailable', async () => {
  const result = await discoverBrowserLogos('https://example.com', {
    importPlaywright: async () => { throw new Error('missing package'); },
  });
  assert.equal(result.diagnostics.status, 'unavailable');
  assert.match(result.diagnostics.errors[0], /missing package/);
  assert.deepEqual(result.candidates, []);
});

test('uses an injected browser, inspects both themes, and deduplicates URLs', async () => {
  const calls = [];
  const page = {
    on() {},
    async route() {},
    setDefaultTimeout(value) { calls.push(['timeout', value]); },
    setDefaultNavigationTimeout() {},
    async emulateMedia(value) { calls.push(['media', value.colorScheme]); },
    async goto(url) { calls.push(['goto', url]); },
    async waitForLoadState() {},
    url() { return 'https://example.com/home'; },
    async evaluate(_fn, context) {
      return [{
        url: 'https://cdn.example.com/logo.svg', source: 'browser-img', kind: 'external',
        evidence: { theme: context.theme },
      }];
    },
    async close() { calls.push(['close']); },
  };
  const browser = { async newPage() { return page; } };
  const result = await discoverBrowserLogos({ url: 'https://example.com', company: 'Example' }, {
    browser, darkMode: true, timeoutMs: 1_000,
  });

  assert.equal(result.diagnostics.status, 'ok');
  assert.equal(result.diagnostics.browserReused, true);
  assert.deepEqual(result.diagnostics.themesInspected, ['light', 'dark']);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].evidence.map(item => item.theme), ['light', 'dark']);
  assert.deepEqual(calls.filter(([name]) => name === 'media'), [['media', 'light'], ['media', 'dark']]);
});

test('dedupe rejects non-HTTP external candidates but retains inline SVG evidence', () => {
  const result = internals.dedupeCandidates([
    { kind: 'external', url: 'data:image/png;base64,AAAA', evidence: {} },
    { kind: 'inline-svg', inlineSvg: '<svg/>', evidence: { theme: 'light' } },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'inline-svg');
  assert.deepEqual(result[0].evidence, [{ theme: 'light' }]);
});

test('rejects credentialed and local browser targets before launch', async () => {
  assert.throws(() => internals.normaliseInput({ url: 'https://user:secret@example.com' }), /without credentials/);
  assert.throws(() => internals.normaliseInput({ url: 'http://127.0.0.1' }), /private-network/);
  assert.throws(() => internals.normaliseInput({ url: 'http://2130706433' }), /private-network/);
  assert.throws(() => internals.normaliseInput({ url: 'http://[::ffff:127.0.0.1]' }), /private-network/);
  assert.throws(() => internals.normaliseInput({ url: 'https://example.com:8443' }), /without credentials/);
});

test('invalid public API input returns diagnostics rather than throwing', async () => {
  const result = await discoverBrowserLogos('not a URL');
  assert.equal(result.diagnostics.status, 'error');
  assert.deepEqual(result.candidates, []);
});

test('browser request validation blocks DNS resolutions to private networks', async () => {
  const denied = await internals.isAllowedBrowserUrl('https://example.test/logo.svg', new Map(), async () => [
    { address: '127.0.0.1', family: 4 },
  ]);
  const allowed = await internals.isAllowedBrowserUrl('https://example.test/logo.svg', new Map(), async () => [
    { address: '93.184.216.34', family: 4 },
  ]);
  assert.equal(denied, false);
  assert.equal(allowed, true);
});

test('hard deadline returns timeout diagnostics and closes the page', async () => {
  let closed = 0;
  const page = {
    on() {}, async route() {}, setDefaultTimeout() {}, setDefaultNavigationTimeout() {},
    async emulateMedia() {}, async goto() { return new Promise(() => {}); },
    async close() { closed += 1; },
  };
  const result = await discoverBrowserLogos('https://example.com', {
    browser: { async newPage() { return page; } }, timeoutMs: 10,
  });
  assert.equal(result.diagnostics.status, 'timeout');
  assert.ok(closed >= 1);
});

test('request route blocks resources after the configured request budget', async () => {
  let handler;
  const actions = [];
  const page = {
    on() {},
    async route(_pattern, callback) { handler = callback; },
    setDefaultTimeout() {}, setDefaultNavigationTimeout() {}, async emulateMedia() {},
    async goto() {
      for (let index = 0; index < 2; index++) {
        await handler({
          request: () => ({ url: () => `https://cdn.example.test/${index}.js`, resourceType: () => 'script' }),
          async continue() { actions.push('continue'); }, async abort() { actions.push('abort'); },
        });
      }
    },
    async waitForLoadState() {}, url() { return 'https://example.test/'; },
    async evaluate() { return []; }, async close() {},
  };
  const result = await discoverBrowserLogos('https://example.test', {
    browser: { async newPage() { return page; } }, maxRequests: 1,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  });
  assert.deepEqual(actions, ['continue', 'abort']);
  assert.equal(result.diagnostics.resourceLimitHit, true);
  assert.equal(result.diagnostics.blockedRequests, 1);
});
