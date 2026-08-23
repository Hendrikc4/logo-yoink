import test from 'node:test';
import assert from 'node:assert/strict';
import { internals, normalizeWebsite } from '../src/extractor.mjs';
import { rankCandidates } from '../src/rank.mjs';

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

test('does not accept an HTML error page merely because it contains an SVG element', () => {
  const bytes = Buffer.from('<html><body><svg viewBox="0 0 100 20"></svg></body></html>');
  assert.equal(internals.imageMetadata(bytes, 'text/html'), null);
});

test('uses an SVG viewBox when percentage dimensions are non-intrinsic', () => {
  const bytes = Buffer.from('<svg width="100%" height="100%" viewBox="0 0 800 100"></svg>');
  assert.deepEqual(internals.imageMetadata(bytes, 'image/svg+xml'), {
    format: 'svg', mimeType: 'image/svg+xml', width: 800, height: 100,
  });
});

test('ranking rewards square high-resolution candidates', () => {
  const square = internals.scoreCandidate({ source: 'manifest', squareish: true, highResolution: true, scalable: false, width: 512, height: 512 });
  const wordmark = internals.scoreCandidate({ source: 'schema', squareish: false, highResolution: true, scalable: false, width: 1200, height: 200 });
  assert.ok(square > wordmark);
});

test('discovers visible logo images, lazy sources, picture srcsets, metadata, and inline header SVG', () => {
  const html = `
    <meta property="og:logo" content="/meta-logo.svg">
    <meta property="og:image" content="/launch-banner.jpg">
    <header><a href="/" aria-label="Acme home">
      <img class="site-logo" alt="Acme" src="/logo.svg" data-src="/logo-lazy.svg">
      <svg viewBox="0 0 200 40" aria-label="Acme logo"><path d="M0 0h20v20z"/></svg>
    </a></header>
    <picture><source srcset="/wordmark-1x.png 1x, /wordmark-2x.png 2x"></picture>`;
  const result = internals.parseHomepage(html, 'https://acme.test/products', { companyName: 'Acme Inc.' });
  const bySource = Object.groupBy(result.candidates, item => item.source);
  assert.equal(bySource['og-logo'][0].url, 'https://acme.test/meta-logo.svg');
  assert.equal(bySource['social-banner'][0].evidence.banner, true);
  assert.equal(bySource['dom-img'].length, 2);
  assert.equal(bySource['dom-img'][0].evidence.dom_region, 'header');
  assert.equal(bySource['dom-img'][0].evidence.home_linked, true);
  assert.equal(bySource['dom-picture'].length, 2);
  assert.match(bySource['inline-svg'][0].url, /^data:image\/svg\+xml;base64,/);
});

test('resolves document-relative assets against the first base element', () => {
  const result = internals.parseHomepage('<base href="https://cdn.example.com/site/"><img class="logo" src="brand.svg">', 'https://example.com/');
  assert.equal(result.candidates[0].url, 'https://cdn.example.com/site/brand.svg');
  assert.equal(result.candidates[0].source_page, 'https://example.com/');
});

test('negative partner context is retained as ranking evidence', () => {
  const { candidates } = internals.parseHomepage('<section class="customer-partners"><img class="logo" alt="Other" src="/other.svg"></section>', 'https://acme.test/');
  assert.equal(candidates[0].evidence.negative_context, true);
  const result = rankCandidates([{ ...candidates[0], width: 200, height: 50, highResolution: true, scalable: true, bytes: 100 }], { companyName: 'Acme' });
  assert.ok(result.candidates[0].score_reasons.includes('negative context -35'));
});

test('role-specific ranking keeps a wide logo separate from an icon', () => {
  const common = { highResolution: true, scalable: true, bytes: 100, evidence: { positive_token: true, dom_region: 'header', home_linked: true } };
  const icon = { ...common, url: 'https://acme.test/icon.svg', source: 'dom-img', width: 256, height: 256 };
  const wide = { ...common, url: 'https://acme.test/acme-logo.svg', source: 'dom-img', width: 800, height: 160 };
  const result = rankCandidates([icon, wide], { companyName: 'Acme' });
  assert.equal(result.selectedByRole.icon.url, icon.url);
  assert.equal(result.selectedByRole.wide.url, wide.url);
  assert.ok(result.selectedByRole.wide.score_reasons.some(reason => reason.startsWith('wide shape')));
});

test('does not serialize inline SVG that depends on an external document', () => {
  const html = '<header><svg class="logo" viewBox="0 0 20 20"><use href="/sprite.svg#logo"/></svg><svg class="logo" viewBox="0 0 20 20"><defs><path id="brand" d="M0 0h2v2z"/></defs><use href="#brand"/></svg></header>';
  const result = internals.parseHomepage(html, 'https://acme.test/');
  assert.equal(result.candidates.filter(item => item.source === 'inline-svg').length, 1);
});

test('does not promote navigation controls or inherit logo semantics from a distant ancestor', () => {
  const html = `
    <header class="logo-bar">
      <a href="/"><svg class="menu-toggle" width="40" height="40"><path d="M0 0h2v2z"/></svg></a>
      <svg class="e-fab-whatsapp" width="448" height="512"><path d="M0 0h2v2z"/></svg>
      <svg width="512" height="512"><path d="M0 0h2v2z"/></svg>
      <a href="/"><svg class="company-logo" width="64" height="64"><path d="M0 0h2v2z"/></svg></a>
    </header>`;
  const result = internals.parseHomepage(html, 'https://acme.test/');
  assert.equal(result.candidates.filter(item => item.source === 'inline-svg').length, 1);
  assert.match(result.candidates.find(item => item.source === 'inline-svg').evidence.semantic_text, /company-logo/);
});

test('does not treat the page hostname as company-name agreement for partner logos', () => {
  const partner = {
    url: 'https://beebizy.com/assets/logo-paramount.svg', source: 'dom-img', width: 320, height: 120,
    highResolution: true, scalable: true, bytes: 100, evidence: { positive_token: true, dom_region: 'body' },
  };
  const result = rankCandidates([partner], { companyName: 'beebizy' });
  assert.equal(result.selectedByRole.wide, null);
  assert.ok(!result.candidates[0].score_reasons.includes('company agreement +12'));
});

test('ignores credentialed and literal private-network asset URLs', () => {
  const html = '<img src="http://127.0.0.1/logo.png"><img src="https://user:pass@example.com/logo.png"><img src="https://cdn.example.com/logo.png">';
  const result = internals.parseHomepage(html, 'https://acme.test/');
  assert.deepEqual(result.candidates.map(item => item.url), ['https://cdn.example.com/logo.png']);
});

test('retains an oversized response prefix and reports truncation and bytes', async () => {
  const diagnostics = { bytesDownloaded: 0 };
  const response = new Response(Buffer.from('head-logo-tail'), { headers: { 'content-length': '14' } });
  const result = await internals.readLimited(response, 9, { truncate: true, diagnostics });
  assert.equal(result.bytes.toString(), 'head-logo');
  assert.equal(result.truncated, true);
  assert.equal(diagnostics.bytesDownloaded, 9);
});
