import assert from 'node:assert/strict';
import test from 'node:test';
import { assertPublicUrl, fetchTimed } from '../src/http-client.mjs';

test('assertPublicUrl accepts public hosts and rejects private DNS results', async () => {
  const publicUrl = await assertPublicUrl('https://example.test/path', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  });
  assert.equal(publicUrl.href, 'https://example.test/path');

  await assert.rejects(() => assertPublicUrl('https://example.test', {
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  }), /non-public address/);
  await assert.rejects(() => assertPublicUrl('https://localhost'), /private-network/);
});

test('fetchTimed revalidates redirects and preserves request diagnostics', async () => {
  const visited = [];
  const diagnostics = { requests: 0 };
  const response = await fetchTimed('https://first.test', {
    diagnostics,
    validateUrl: async value => { visited.push(value); },
    fetchImpl: async value => value === 'https://first.test'
      ? new Response(null, { status: 302, headers: { location: 'https://second.test/logo.svg' } })
      : new Response('ok', { status: 200 }),
  });

  assert.equal(await response.text(), 'ok');
  assert.deepEqual(visited, ['https://first.test', 'https://second.test/logo.svg']);
  assert.equal(diagnostics.requests, 2);
});
