import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverBrowserLogos, internals } from '../src/discover-browser.mjs';
import { internals as extractorInternals } from '../src/extractor.mjs';
import { rankCandidates } from '../src/rank.mjs';

async function inspectFixture(html, css = '') {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.route('https://acme.test/**', async route => {
    if (new URL(route.request().url()).pathname === '/site.css') {
      await route.fulfill({ contentType: 'text/css', body: css });
    } else {
      await route.fulfill({ contentType: 'text/html', body: html });
    }
  });
  try {
    await page.goto('https://acme.test/');
    return await internals.inspectRenderedCandidates(page, {
      theme: 'light', company: 'Acme', domain: 'acme.test', headerRetention: true,
    });
  } finally {
    await browser.close();
  }
}

test('returns actionable diagnostics when Playwright is unavailable', async () => {
  const result = await discoverBrowserLogos('https://example.com', {
    importPlaywright: async () => { throw new Error('missing package'); },
  });
  assert.equal(result.diagnostics.status, 'unavailable');
  assert.match(result.diagnostics.errors[0], /missing package/);
  assert.deepEqual(result.candidates, []);
});

test('resolves lazy serverless launch options only when launching a browser', async () => {
  let resolved = 0;
  const launches = [];
  const result = await discoverBrowserLogos('https://example.com', {
    importPlaywright: async () => ({ chromium: {
      async launch(options) {
        launches.push(options);
        return {
          async newPage() { throw new Error('stop after launch'); },
          async close() {},
        };
      },
    } }),
    launchOptions: async () => {
      resolved += 1;
      return { executablePath: '/tmp/chromium', args: ['--serverless'] };
    },
  });
  assert.equal(resolved, 1);
  assert.deepEqual(launches, [{ headless: true, executablePath: '/tmp/chromium', args: ['--serverless'] }]);
  assert.equal(result.diagnostics.status, 'error');
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

test('parses ordinary srcset URLs without treating malformed input as a URL', () => {
  assert.deepEqual(internals.parseSrcsetCandidates('images/logo.png 320w, images/logo@2x.png 640w'), [
    'images/logo.png', 'images/logo@2x.png',
  ]);
  assert.deepEqual(internals.parseSrcsetCandidates('/logo.svg 1x, https://cdn.example/logo.svg?crop=1,2 2x'), [
    '/logo.svg', 'https://cdn.example/logo.svg?crop=1,2',
  ]);
  assert.deepEqual(internals.parseSrcsetCandidates('logo.png, logo@2x.png 2x'), ['logo.png', 'logo@2x.png']);
  assert.deepEqual(internals.parseSrcsetCandidates('logo.png nope, broken value 2q, ,'), []);
  assert.deepEqual(internals.parseSrcsetCandidates(null), []);
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

test('inspects a bare header home-link background after more than 80 earlier hidden home links', async () => {
  const earlier = Array.from({ length: 91 }, (_, index) => `<a class="prior" href="/">Link ${index}</a>`).join('');
  const candidates = await inspectFixture(`
    <link rel="stylesheet" href="/site.css">
    ${earlier}<a href="/"></a>
  `, '.prior { display:none; } body > a:last-child { display:block; width:183px; height:32px; background-image:url("/assets/identity.svg"); }');
  const candidate = candidates.find(item => item.url === 'https://acme.test/assets/identity.svg');
  assert.equal(candidate?.source, 'browser-css-background');
  assert.equal(candidate?.evidence.homeLinked, true);
  assert.equal(candidate?.evidence.domRegion, 'document');
});

test('decorative header backgrounds are observed but do not become wide selections', async () => {
  const [raw] = await inspectFixture(`
    <link rel="stylesheet" href="/site.css"><header></header>
  `, 'header { width:400px; height:100px; background-image:url("/assets/decoration.svg"); }');
  const disposition = extractorInternals.browserCandidateDisposition(raw, 'https://acme.test/', ['wide']);
  assert.equal(disposition.stage, 'retained');
  const validated = { ...disposition.candidate, width: 400, height: 100, highResolution: true, scalable: true, bytes: 100 };
  assert.equal(rankCandidates([validated], { companyName: 'Acme' }).selectedByRole.wide, null);
});

test('ignores hidden mobile background duplicates when a visible header copy exists', async () => {
  const candidates = await inspectFixture(`
    <link rel="stylesheet" href="/site.css"><header><a href="/"></a><a href="/" class="mobile"></a></header>
  `, 'header a { display:block; width:180px; height:36px; background-image:url("/assets/identity.svg"); } .mobile { display:none; }');
  const matches = candidates.filter(item => item.url === 'https://acme.test/assets/identity.svg');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].evidence.homeLinked, true);
});

test('strong home-link structure admits a CSS background without logo filename tokens', async () => {
  const [raw] = await inspectFixture(`
    <link rel="stylesheet" href="/site.css"><header><a href="/"></a></header>
  `, 'header a { display:block; width:183px; height:32px; background-image:url("/assets/identity.svg"); }');
  const disposition = extractorInternals.browserCandidateDisposition(raw, 'https://acme.test/', ['wide']);
  assert.equal(disposition.reason, 'home-linked');
  const validated = { ...disposition.candidate, width: 183, height: 32, highResolution: true, scalable: true, bytes: 100 };
  assert.equal(rankCandidates([validated], { companyName: 'Acme' }).selectedByRole.wide?.url, 'https://acme.test/assets/identity.svg');
});
