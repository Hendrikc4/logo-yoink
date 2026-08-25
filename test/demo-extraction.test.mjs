import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createDemoExtractionService } from '../src/demo/extraction-service.mjs';
import { DemoHttpError } from '../src/demo/security.mjs';

function request({ headers = {}, body = '' } = {}) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []);
  stream.headers = headers;
  stream.socket = { remoteAddress: '203.0.113.10', encrypted: false };
  return stream;
}

test('shared demo extraction service validates, normalizes, and executes with adapter options', async () => {
  const calls = [];
  const service = createDemoExtractionService({
    environment: {},
    extractionOptions: () => ({ browser: false, adapter: 'test' }),
    extract: async (website, options) => {
      calls.push({ website, options });
      return { selectedByRole: {} };
    },
  });

  const result = await service.handle(request({
    headers: { 'content-type': 'application/json' },
    body: '{"website":" example.com "}',
  }));

  assert.deepEqual(calls, [{ website: 'https://example.com/', options: { browser: false, adapter: 'test' } }]);
  assert.deepEqual(result, {
    status: 200,
    headers: { 'ratelimit-limit': '20', 'ratelimit-remaining': '19' },
    payload: { selectedByRole: {} },
  });
});

test('shared demo extraction service maps request and extraction failures consistently', async () => {
  const invalidRequest = createDemoExtractionService({ environment: {}, extract: async () => ({}) });
  assert.deepEqual(await invalidRequest.handle(request({ headers: { 'content-type': 'text/plain' }, body: '{}' })), {
    status: 415,
    headers: {},
    payload: { error: 'Content-Type must be application/json.' },
  });

  const failedExtraction = createDemoExtractionService({
    environment: {},
    extract: async () => { throw new Error('sensitive failure'); },
  });
  assert.deepEqual(await failedExtraction.handle(request({
    headers: { 'content-type': 'application/json' },
    body: '{"website":"example.com"}',
  })), {
    status: 400,
    headers: {},
    payload: { error: 'We could not inspect that website.' },
  });
});

test('shared demo extraction service preserves retry metadata from the guard', async () => {
  const service = createDemoExtractionService({
    environment: {},
    guard: {
      check() { throw new DemoHttpError(503, 'The demo is busy.', { retryAfter: 5 }); },
      run() { assert.fail('run should not be called'); },
    },
  });

  assert.deepEqual(await service.handle(request()), {
    status: 503,
    headers: { 'retry-after': '5' },
    payload: { error: 'The demo is busy.' },
  });
});
