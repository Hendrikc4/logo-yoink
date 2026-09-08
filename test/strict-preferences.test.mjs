import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createDemoExtractionService } from '../src/demo/extraction-service.mjs';
import { rankCandidates } from '../src/rank.mjs';

test('HTTP strict preferences reach selection and cannot reuse a best-effort cached response', async () => {
  let calls = 0;
  const candidate = {
    source: 'html-icon', url: 'https://acme.test/logo.png', width: 128, height: 128,
    highResolution: true, background: 'opaque', bytes: 100, evidence: {},
  };
  const service = createDemoExtractionService({
    environment: {}, extractionOptions: () => ({}),
    extract: async (_website, options) => {
      calls++;
      return rankCandidates([candidate], options);
    },
  });
  const request = strict => {
    const stream = Readable.from([Buffer.from(JSON.stringify({ website: 'acme.test',
      preferences: { icon: { background: 'transparent', strict } } }))]);
    stream.headers = { 'content-type': 'application/json' };
    stream.socket = { remoteAddress: '203.0.113.10', encrypted: false };
    return stream;
  };
  const bestEffort = await service.handle(request(false));
  const strict = await service.handle(request(true));
  assert.ok(bestEffort.payload.assets.icon);
  assert.equal(bestEffort.payload.preferenceMatch.icon, 'fallback');
  assert.equal(strict.payload.assets.icon, null);
  assert.equal(strict.payload.preferenceMatch.icon, 'unmatched');
  assert.equal(calls, 2);
});
