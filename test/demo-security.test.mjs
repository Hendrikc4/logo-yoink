import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import {
  assertDemoRequestOrigin,
  createDemoGuard,
  demoLimits,
  DemoHttpError,
  publicDemoExtractionOptions,
  readDemoJson,
  securityHeaders,
} from '../src/demo/security.mjs';

function request({ headers = {}, body = '', address = '203.0.113.10' } = {}) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  stream.headers = headers;
  stream.socket = { remoteAddress: address, encrypted: false };
  return stream;
}

test('demo request validation accepts a website and bounded logo preferences', async () => {
  const defaults = {
    icon: { theme: 'any', color: 'any', background: 'any' },
    logo: { theme: 'any', color: 'any', background: 'any' },
  };
  const valid = request({ headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{"website":" example.com "}' });
  assert.deepEqual(await readDemoJson(valid), { website: 'example.com', preferences: defaults });
  const preferred = request({ headers: { 'content-type': 'application/json' }, body: '{"website":"example.com","preferences":{"icon":{"color":"white"},"logo":{"theme":"dark","background":"transparent"}}}' });
  assert.deepEqual(await readDemoJson(preferred), { website: 'example.com', preferences: {
    icon: { theme: 'any', color: 'white', background: 'any' },
    logo: { theme: 'dark', color: 'any', background: 'transparent' },
  } });
  const optedOut = request({ headers: { 'content-type': 'application/json' }, body: '{"website":"example.com","wikimediaFallback":false}' });
  assert.deepEqual(await readDemoJson(optedOut), { website: 'example.com', preferences: defaults, wikimediaFallback: false });

  await assert.rejects(
    readDemoJson(request({ headers: { 'content-type': 'text/plain' }, body: '{}' })),
    error => error instanceof DemoHttpError && error.status === 415,
  );
  await assert.rejects(
    readDemoJson(request({ headers: { 'content-type': 'application/json' }, body: '{"website":"example.com","extra":true}' })),
    error => error instanceof DemoHttpError && error.status === 400,
  );
  await assert.rejects(
    readDemoJson(request({ headers: { 'content-type': 'application/json' }, body: '{"website":"example.com","wikimediaFallback":"no"}' })),
    error => error instanceof DemoHttpError && error.status === 400 && /boolean/.test(error.message),
  );
  await assert.rejects(
    readDemoJson(request({ headers: { 'content-type': 'application/json' }, body: '{"website":"example.com","preferences":{"logo":{"theme":"sepia"}}}' })),
    error => error instanceof DemoHttpError && error.status === 400 && /theme/.test(error.message),
  );
  await assert.rejects(
    readDemoJson(request({ headers: { 'content-type': 'application/json' }, body: '{"website":"example.com","preferences":{"icon":{"color":"sepia"}}}' })),
    error => error instanceof DemoHttpError && error.status === 400 && /color/.test(error.message),
  );
});

test('cross-site browser requests are rejected', () => {
  assert.throws(
    () => assertDemoRequestOrigin(request({ headers: { host: 'logo-yoink.test', origin: 'https://evil.test', 'sec-fetch-site': 'cross-site' } })),
    error => error instanceof DemoHttpError && error.status === 403,
  );
  assert.doesNotThrow(() => assertDemoRequestOrigin(request({ headers: { host: 'logo-yoink.test', origin: 'http://logo-yoink.test', 'sec-fetch-site': 'same-origin' } })));
});

test('guard rate-limits clients and coalesces identical work', async () => {
  let now = 1_000;
  const guard = createDemoGuard({ clientBurst: 2, clientWindowMs: 10_000, globalBurst: 20, globalWindowMs: 10_000, maxConcurrent: 1, now: () => now, environment: {} });
  const first = request({ address: '198.51.100.4' });
  const second = request({ address: '198.51.100.4' });
  const third = request({ address: '198.51.100.4' });
  guard.check(first);
  guard.check(second);
  assert.throws(() => guard.check(third), error => error instanceof DemoHttpError && error.status === 429 && error.retryAfter === 10);

  let runs = 0;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const a = guard.run('https://example.com/', async () => { runs += 1; await held; return 'ok'; });
  const b = guard.run('https://example.com/', () => { runs += 1; return 'duplicate'; });
  assert.strictEqual(a, b);
  assert.throws(() => guard.run('https://other.test/', () => 'other'), error => error.status === 503);
  release();
  assert.equal(await a, 'ok');
  assert.equal(runs, 1);

  now += 10_000;
  assert.doesNotThrow(() => guard.check(request({ address: '198.51.100.4' })));
});

test('public demo enables fallbacks while keeping their work tightly bounded', () => {
  const limits = demoLimits({});
  assert.deepEqual(limits, {
    bodyBytes: 2 * 1024,
    clientBurst: 20,
    clientWindowMs: 10 * 60 * 1000,
    globalBurst: 60,
    globalWindowMs: 60 * 1000,
    maxConcurrent: 2,
  });
  const options = publicDemoExtractionOptions({ JINA_API_KEY: 'secret', BROWSER_DISCOVERY: '1' });
  assert.equal(options.jinaApiKey, 'secret');
  assert.equal(options.browser, true);
  assert.equal(options.wikimediaFallback, true);
  assert.equal(options.deepWide, true);
  assert.equal(options.spaBundles, true);
  assert.equal(options.maxCandidates, 8);
  assert.equal(options.maxImageBytes, 768 * 1024);
  assert.equal(options.timeoutMs, 8_000);
  assert.equal(options.bimi, false);
  assert.equal(publicDemoExtractionOptions({ PUBLIC_DEMO_BIMI: '1' }).bimi, true);
  assert.equal(publicDemoExtractionOptions({ JINA_API_KEY: 'secret', PUBLIC_DEMO_ALLOW_JINA: '0' }).jinaApiKey, null);
  assert.equal(publicDemoExtractionOptions({ PUBLIC_DEMO_BROWSER: '0' }).browser, false);
  assert.equal(publicDemoExtractionOptions({ PUBLIC_DEMO_WIKIMEDIA: '0' }).wikimediaFallback, false);
  assert.match(securityHeaders['content-security-policy'], /frame-ancestors 'none'/);
  assert.doesNotMatch(securityHeaders['content-security-policy'], /unsafe-inline|unsafe-eval/);
});
