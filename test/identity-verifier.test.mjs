import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  IDENTITY_MODEL,
  IDENTITY_PROMPT_VERSION,
  calibrateIdentityVerifier,
  identityCacheKey,
  openAiRequest,
  renderIdentityPanels,
  shouldWithhold,
  validateVerdict,
  verifyIdentity,
} from '../src/identity-verifier.mjs';

async function image() {
  return sharp({ create: { width: 120, height: 40, channels: 4, background: '#ff3366' } }).png().toBuffer();
}

function icoImage() {
  const bytes = Buffer.alloc(70);
  bytes.writeUInt16LE(1, 2);
  bytes.writeUInt16LE(1, 4);
  bytes[6] = 1;
  bytes[7] = 1;
  bytes.writeUInt16LE(1, 10);
  bytes.writeUInt16LE(32, 12);
  bytes.writeUInt32LE(48, 14);
  bytes.writeUInt32LE(22, 18);
  bytes.writeUInt32LE(40, 22);
  bytes.writeInt32LE(1, 26);
  bytes.writeInt32LE(2, 30);
  bytes.writeUInt16LE(1, 34);
  bytes.writeUInt16LE(32, 36);
  bytes.writeUInt32LE(4, 42);
  bytes.set([0, 0, 255, 255], 62);
  return bytes;
}

function input(bytes, overrides = {}) {
  return {
    image_bytes: bytes,
    company: 'Example Company',
    domain: 'example.com',
    source_url: 'https://example.com/logo.svg',
    placement_evidence: { dom_region: 'header', home_linked: true, alt: 'Example Company logo' },
    page_identity: { og_site_name: 'Example Company', title: 'Example Company' },
    ...overrides,
  };
}

test('cache identity is exactly content, company, domain, and prompt version', () => {
  const base = { contentHash: 'a'.repeat(64), company: 'Example', domain: 'EXAMPLE.com' };
  assert.equal(identityCacheKey(base), identityCacheKey({ ...base, domain: 'example.com' }));
  assert.notEqual(identityCacheKey(base), identityCacheKey({ ...base, company: 'Other' }));
  assert.notEqual(identityCacheKey(base), identityCacheKey({ ...base, promptVersion: `${IDENTITY_PROMPT_VERSION}-next` }));
});

test('light and dark panels are rendered into one deterministic PNG', async () => {
  const bytes = await image();
  const first = await renderIdentityPanels(bytes);
  const second = await renderIdentityPanels(bytes);
  assert.deepEqual(first, second);
  assert.deepEqual(await sharp(first).metadata().then(({ width, height, format }) => ({ width, height, format })), { width: 1024, height: 512, format: 'png' });
});

test('ICO harmful controls render through their frozen DIB frame', async () => {
  const panel = await renderIdentityPanels(icoImage());
  assert.deepEqual(await sharp(panel).metadata().then(({ width, height, format }) => ({ width, height, format })), { width: 1024, height: 512, format: 'png' });
});

test('request is one temperature-zero vision call with strict JSON output', async () => {
  const bytes = await image();
  const request = openAiRequest({ input: input(bytes), panelBytes: await renderIdentityPanels(bytes) });
  assert.equal(request.model, IDENTITY_MODEL);
  assert.equal(request.temperature, 0);
  assert.equal(request.store, false);
  assert.equal(request.input[0].content.filter(item => item.type === 'input_image').length, 1);
  assert.equal(request.text.format.type, 'json_schema');
  assert.equal(request.text.format.strict, true);
  assert.equal(request.tools, undefined);
});

test('ambiguous and reject withhold while accept only avoids the veto', () => {
  assert.equal(shouldWithhold({ judgment: 'accept', reason: 'requested_identity_visible' }), false);
  assert.equal(shouldWithhold({ judgment: 'reject', reason: 'different_brand_visible' }), true);
  assert.equal(shouldWithhold({ judgment: 'ambiguous', reason: 'insufficient_context' }), true);
  assert.throws(() => validateVerdict({ judgment: 'accept', reason: 'different_brand_visible' }));
});

test('successful replay is zero-network and byte-identical', async () => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'logo-yoink-verifier-'));
  const bytes = await image();
  let calls = 0;
  const provider = async () => {
    calls++;
    return { verdict: { judgment: 'accept', reason: 'requested_identity_visible' }, usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } };
  };
  const cold = await verifyIdentity(input(bytes), { cacheDirectory, provider });
  const diskBytes = await readFile(cold.cache_path);
  const replay = await verifyIdentity(input(bytes), { cacheDirectory, replayOnly: true, provider: async () => { throw new Error('network called'); } });
  assert.equal(calls, 1);
  assert.equal(cold.network_calls, 1);
  assert.equal(replay.network_calls, 0);
  assert.deepEqual(cold.bytes, diskBytes);
  assert.deepEqual(replay.bytes, diskBytes);
});

test('invalid provider output gets exactly one retry and failures are not cached', async () => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'logo-yoink-verifier-retry-'));
  const bytes = await image();
  let calls = 0;
  const recovered = await verifyIdentity(input(bytes), { cacheDirectory, provider: async () => {
    calls++;
    if (calls === 1) return { verdict: { judgment: 'accept', reason: 'different_brand_visible' } };
    return { verdict: { judgment: 'ambiguous', reason: 'visual_identity_unclear' }, usage: {} };
  } });
  assert.equal(calls, 2);
  assert.equal(recovered.artifact.metrics.network_calls, 2);

  const otherCache = await mkdtemp(join(tmpdir(), 'logo-yoink-verifier-fail-'));
  calls = 0;
  await assert.rejects(verifyIdentity(input(bytes), { cacheDirectory: otherCache, provider: async () => { calls++; throw new Error('offline'); } }), /after one retry/);
  assert.equal(calls, 2);

  const invalidCache = await mkdtemp(join(tmpdir(), 'logo-yoink-verifier-invalid-'));
  calls = 0;
  await assert.rejects(verifyIdentity(input(bytes), { cacheDirectory: invalidCache, provider: async () => {
    calls++;
    return { verdict: { judgment: 'accept', reason: 'different_brand_visible' }, usage: {} };
  } }), /after one retry/);
  assert.equal(calls, 2);
});

test('calibration counts ambiguous as non-accept and reports strict accept precision', async () => {
  const cacheDirectory = await mkdtemp(join(tmpdir(), 'logo-yoink-calibration-'));
  const bytes = await image();
  const verdicts = [
    { judgment: 'accept', reason: 'requested_identity_visible' },
    { judgment: 'reject', reason: 'different_brand_visible' },
    { judgment: 'ambiguous', reason: 'insufficient_context' },
  ];
  let index = 0;
  const cases = [
    { ...input(bytes, { company: 'Correct' }), case_id: 'correct', expected_identity: 'correct' },
    { ...input(bytes, { company: 'Wrong' }), case_id: 'wrong', expected_identity: 'wrong' },
    { ...input(bytes, { company: 'Ambiguous' }), case_id: 'ambiguous', expected_identity: 'ambiguous' },
  ];
  const result = await calibrateIdentityVerifier(cases, { cacheDirectory, provider: async () => ({ verdict: verdicts[index++], usage: {} }) });
  assert.equal(result.summary.accept_precision, 1);
  assert.deepEqual(result.summary.confusion, { 'correct->accept': 1, 'wrong->reject': 1, 'ambiguous->ambiguous': 1 });
  const replay = await calibrateIdentityVerifier(cases, { cacheDirectory, replayOnly: true, provider: async () => { throw new Error('network called'); } });
  assert.deepEqual(replay, result);
});
