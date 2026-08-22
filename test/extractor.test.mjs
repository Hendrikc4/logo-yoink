import test from 'node:test';
import assert from 'node:assert/strict';
import { internals, normalizeWebsite } from '../src/extractor.mjs';

test('normalizes bare company domains', () => {
  const result = normalizeWebsite('www.Example.com/company');
  assert.equal(result.url.href, 'https://www.example.com/company');
  assert.equal(result.domain, 'example.com');
});

test('rejects local and unsupported URLs', () => {
  assert.throws(() => normalizeWebsite('http://127.0.0.1:3000'), /private-network/);
  assert.throws(() => normalizeWebsite('file:///etc/passwd'), /HTTP and HTTPS/);
});

test('parses favicon, Apple, manifest, and flexible Schema.org logo markup', () => {
  const html = `
    <link rel="icon" sizes="32x32" href="/favicon.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
    <link rel="manifest" href="/site.webmanifest">
    <script type="application/ld+json">{
      "@type": "Organization",
      "logo": { "contentUrl": "/company-logo.svg" }
    }</script>`;
  const result = internals.parseHomepage(html, 'https://example.com/about');
  assert.deepEqual(result.manifests, ['https://example.com/site.webmanifest']);
  assert.deepEqual(result.candidates.map(item => [item.source, item.url]), [
    ['html-icon', 'https://example.com/favicon.png'],
    ['apple', 'https://example.com/apple.png'],
    ['schema', 'https://example.com/company-logo.svg'],
  ]);
});

test('reads PNG dimensions from image bytes', () => {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(512, 16);
  bytes.writeUInt32BE(256, 20);
  assert.deepEqual(internals.imageMetadata(bytes, 'image/png'), {
    format: 'png', mimeType: 'image/png', width: 512, height: 256,
  });
});

test('ranking rewards square high-resolution candidates', () => {
  const square = internals.scoreCandidate({ source: 'manifest', squareish: true, highResolution: true, scalable: false, width: 512, height: 512 });
  const wordmark = internals.scoreCandidate({ source: 'schema', squareish: false, highResolution: true, scalable: false, width: 1200, height: 200 });
  assert.ok(square > wordmark);
});
