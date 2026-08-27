import test from 'node:test';
import assert from 'node:assert/strict';
import yoink, { DEFAULT_OPTIONS, extractLogos, normalizeWebsite } from '../src/index.mjs';

test('public package entry point exposes the simple and low-level APIs', () => {
  assert.equal(typeof yoink, 'function');
  assert.equal(typeof extractLogos, 'function');
  assert.equal(normalizeWebsite('example.com').domain, 'example.com');
  assert.deepEqual(DEFAULT_OPTIONS, {
    scrapers: ['browser'],
    deep: true,
    wikimedia: true,
    bimi: false,
    cachedFavicon: true,
  });
});

test('public API rejects unknown scrapers and explains missing Jina configuration', async () => {
  await assert.rejects(yoink('example.com', { scrapers: ['unknown'] }), /Unsupported scraper/);
  await assert.rejects(yoink('example.com', { scrapers: ['jina'], jinaApiKey: '' }), /no jinaApiKey/);
});
