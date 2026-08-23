import test from 'node:test';
import assert from 'node:assert/strict';
import { internals, normalizeWebsite } from '../src/extractor.mjs';
import { genericAssetReason, rankCandidates } from '../src/rank.mjs';

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

test('rejects known platform defaults, compliance badges, and UI glyphs without blocking the platform itself', () => {
  const common = { source: 'dom-img', width: 240, height: 80, highResolution: true, scalable: false, bytes: 100 };
  const namecheap = { ...common, url: 'https://example.test/logo.svg', evidence: { semantic_text: 'Namecheap Logo', positive_token: true, dom_region: 'header' } };
  const matomo = { ...common, url: 'https://example.test/plugins/Morpheus/images/logo.svg?matomo', evidence: { semantic_text: 'default-piwik-logo Matomo', positive_token: true, dom_region: 'nav' } };
  const matomoApp = { ...common, width: 256, height: 256, source: 'manifest', url: 'https://example.test/plugins/CoreHome/images/applogo_256.png', evidence: {} };
  const badge = { ...common, width: 100, height: 100, url: 'https://example.test/logo-soc-2.svg', evidence: { semantic_text: 'SOC 2 Type I compliant site-footer', positive_token: true, dom_region: 'footer' } };
  const language = { ...common, width: 100, height: 100, source: 'inline-svg', url: 'data:image/svg+xml;base64,PHN2Zy8+', evidence: { semantic_text: 'svg-inline--fa fa-language navbar', home_linked: true, dom_region: 'nav' } };
  for (const item of [namecheap, matomo, matomoApp, badge, language]) {
    const result = rankCandidates([item], { companyName: 'Acme' });
    assert.deepEqual(result.candidates[0].predicted_roles, []);
    assert.match(result.candidates[0].score_reasons.join(' '), /generic exclusion/);
  }
  assert.equal(genericAssetReason(namecheap, 'Namecheap'), null);
  assert.equal(genericAssetReason({ ...namecheap, source_page: 'https://www.namecheap.com/' }), null);
});

test('rejects the shared Wix default favicon but keeps custom Wix-hosted assets', () => {
  const defaultWix = { source: 'html-icon', url: 'https://static.parastorage.com/client/pfavico.ico', width: 16, height: 16, bytes: 100, evidence: {} };
  const customWix = { ...defaultWix, url: 'https://static.wixstatic.com/media/site-specific-id.png', width: 180, height: 180, highResolution: true };
  assert.match(genericAssetReason(defaultWix, 'Acme'), /Wix default favicon/);
  assert.equal(genericAssetReason(customWix, 'Acme'), null);
  assert.match(genericAssetReason({ ...customWix, observed: { byte_hash: '33c1436f8c40ca2582d091c449fccc34ed9bf73f02526c5fdef44f4f06c6321b' } }, 'Acme'), /Wix default favicon/);
  assert.deepEqual(rankCandidates([defaultWix], { companyName: 'Acme' }).candidates[0].predicted_roles, []);
  assert.deepEqual(rankCandidates([customWix], { companyName: 'Acme' }).candidates[0].predicted_roles, ['icon', 'favicon']);
});

test('rejects social glyphs, inline controls, template marks, and content imagery', () => {
  const common = { source: 'dom-img', highResolution: true, scalable: false, bytes: 100, evidence: { dom_region: 'body', home_linked: false } };
  const cases = [
    { ...common, url: 'https://example.test/instagram.svg', width: 448, height: 512, scalable: true, evidence: { semantic_text: 'social-icons instagram', dom_region: 'nav' } },
    { ...common, source: 'inline-svg', url: 'data:image/svg+xml;base64,PHN2Zy8+', width: 64, height: 64, scalable: true, evidence: { semantic_text: 'icon_play lightbox', home_linked: true, dom_region: 'body' } },
    { ...common, url: 'https://cdn.test/untitled-ui-logo.png', width: 400, height: 100, evidence: { semantic_text: 'uui-logo_component', dom_region: 'footer', home_linked: true } },
    { ...common, url: 'https://example.test/article.png', width: 700, height: 650, evidence: { ...common.evidence, alt: 'How to grow your business' } },
    { ...common, url: 'https://example.test/app-demo.jpg', width: 1200, height: 600, evidence: { ...common.evidence, alt: 'Dashboard screenshot' } },
    { ...common, url: 'https://example.test/product.jpg', width: 400, height: 500, evidence: { semantic_text: 'featured-products Product Image', dom_region: 'header' } },
    { ...common, url: 'https://example.test/hero-landscaping.webp', width: 1200, height: 500, evidence: { semantic_text: 'hero-section', dom_region: 'body', home_linked: false, positive_token: false } },
    { ...common, url: 'https://example.test/feature.svg', width: 45, height: 45, scalable: true, evidence: { alt: 'Built for the way you work', dom_region: 'body', home_linked: false, positive_token: false } },
    { ...common, source: 'inline-svg', url: 'data:image/svg+xml;base64,PHN2Zy8+', width: 14, height: 14, scalable: true, evidence: { semantic_text: 'tabler-icon tabler-icon-copyright', dom_region: 'body', home_linked: true } },
    { ...common, url: 'https://example.test/ventionWorksWithLogos/Marca.svg', width: 160, height: 40, scalable: true, evidence: { alt: 'Enterprises logo 9', dom_region: 'body' } },
    { ...common, source: 'schema', url: 'https://example.test/images/og-default.png', width: 1200, height: 630, evidence: { dom_region: 'head' } },
    { ...common, url: 'https://example.test/logo-789bet.png', width: 500, height: 200, evidence: { alt: '789BET', dom_region: 'header', home_linked: true, positive_token: true } },
  ];
  for (const item of cases) assert.deepEqual(rankCandidates([item], { companyName: 'Acme' }).candidates[0].predicted_roles, []);

  const actualBodyLogo = { ...common, url: 'https://example.test/acme-logo.png', width: 512, height: 512, evidence: common.evidence };
  assert.equal(genericAssetReason(actualBodyLogo, 'Acme'), null);
});

test('rejects observed application defaults and repurposed-site assets by exact signature', () => {
  const candidate = hash => ({ source: 'manifest', url: 'https://example.test/logo512.png', width: 512, height: 512, observed: { byte_hash: hash }, evidence: {} });
  assert.match(genericAssetReason(candidate('9ea4f4da7050c0cc408926f6a39c253624e9babb1d43c7977cd821445a60b461'), 'Edificex'), /Create React App/);
  assert.match(genericAssetReason(candidate('3646840f40e10d4b14e9d62f41087a09ffe0384628d093f47337580305b18353'), 'Bhr'), /RealReports/);
  assert.equal(genericAssetReason(candidate('3646840f40e10d4b14e9d62f41087a09ffe0384628d093f47337580305b18353'), 'RealReports'), null);
  assert.match(genericAssetReason(candidate('edf01f937bdf9c38ebcd30d84cb5acde5e2101e9c64c1c9b3a4a1351ea7886a0'), 'Bhr'), /RealReports/);
  assert.equal(genericAssetReason(candidate('edf01f937bdf9c38ebcd30d84cb5acde5e2101e9c64c1c9b3a4a1351ea7886a0'), 'RealReports'), null);
  const godaddy = { ...candidate('custom'), url: 'https://img1.wsimg.com/isteam/ip/static/pwa-app/logo-default.png/:/rs=w:512,h:512,m' };
  assert.match(genericAssetReason(godaddy, 'Trustiu'), /GoDaddy default/);
});

test('rejects a non-home-linked foreign named logo but keeps the company logo', () => {
  const common = { source: 'dom-img', url: 'https://example.test/partner-logo.svg', width: 400, height: 100, scalable: true, evidence: { alt: 'MGH Logo', positive_token: true, dom_region: 'header', home_linked: false } };
  assert.match(genericAssetReason(common, 'Watershed Informatics'), /foreign named logo|customer or partner logo/);
  assert.equal(genericAssetReason({ ...common, url: 'https://example.test/watershed-logo.svg', evidence: { ...common.evidence, alt: 'Watershed Logo' } }, 'Watershed Informatics'), null);
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
